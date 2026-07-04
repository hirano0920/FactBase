# 根拠 — 政府データ取り込みパイプライン設計

## Radarの話題検知ソース（一次情報検証用DBとは別レイヤー）

7/4時点で実疎通確認済み。詳細は`scripts/radar/feeds.json`と`scripts/radar/sources/`。

| 機関 | 方式 | 備考 |
|---|---|---|
| 首相官邸・財務省・金融庁・法務省・厚労省・外務省 | 公式RSS | feeds.jsonに列挙 |
| 日本銀行 | 公式RSS（`boj.or.jp/rss/whatsnew.xml`等） | 金融政策決定会合・展望レポート等 |
| NHK | 公式RSS（政治/経済/国際/社会/科学） | feeds.json |
| 裁判所 | HTML差分監視（`scripts/radar/sources/courts.ts`） | 公式RSSなし。お知らせ一覧は項目単位、開廷期日情報は指紋監視 |
| 衆議院・参議院 | SMRI議案DB（`scripts/radar/sources/diet.ts`） | 公式RSSなし。[smartnews-smri](https://github.com/smartnews-smri)のOSS議案データを利用。現国会分のみ抽出し、審議状況の変化を検知 |
| Google Newsクエリ | RSS | 政治/国会/経済/財政・日銀/法律/人権/国際 |
| 文春オンライン | RSS | — |

**断念したもの**（正直な記録）: 経済産業省(WAFで直接fetch()を403拒否)、e-Stat(RSS配信を2023年9月に終了)、主要全国紙・共同/時事(無料の公式RSSなし)、Yahoo!ニュース(規約が個人利用限定)。

裁判所・衆参のHTML差分/SMRI由来イベントは、RSSと同じ`SourceEvent`テーブル・同じ重複排除（feedName+titleのハッシュ）に乗る設計。専用の差分ストレージは作っていない。

## 方針: 「スクレイピング」ではなく公式APIを最優先

| ソース | 取得方法 | 更新頻度 | スクリプト |
|---|---|---|---|
| e-Gov法令 | **公式API v2**（XML/JSON） | 週次差分 + 争点追加時 | `scripts/ingest/fetch_egov.py` |
| 国会会議録 | **国立国会図書館 公式API** | 国会中: 日次 / 閉会: 停止 | `scripts/ingest/fetch_kokkai.py` |
| 条約・歴史文書 | 公式APIなし。人間が原文を用意し投入 | 一度きり（静的資料） | `scripts/ingest/fetch_manual.py` |
| 判例（判決文） | 未実装（次フェーズ。公式APIがなくスクレイピングが必要） | — | — |
| 統計（GDP・CPI等） | 未実装（次フェーズ。数値主張の検証は別ロジックが必要） | — | `StatisticSeries`/`StatisticPoint`はスキーマのみ用意済み |

公式APIを使う理由:
- 利用規約上クリーン（e-Gov API・国会会議録APIは公開データの機械取得を想定した提供）
- HTML構造変更に壊されない
- 出典URLが正規に作れる（FCの「必ず出典リンク」要件）

法令はe-Gov法令API v2の `GET /laws?law_title=...` で法令名から`law_id`を直接検索できる（実機確認済み）。
そのため`sources/registry.json`は法令**名**で持ち、IDは実行時にAPIで解決する（記憶によるID決め打ちをしない＝誤情報混入の防止）。

## アーキテクチャ

```
[e-Gov API] ────────┐
[国会会議録API] ─────┼→ fetch_*.py → チャンク化(200〜600字) → SHA256ハッシュ
[条約/歴史文書(手動)] ┘         ↑ sync-trending-keywords.ts が
                                  Radar自動公開争点からkokkai検索語を自動追加
                          既存ハッシュと比較（変更なし→skip、¥0）
                                        ↓ 変更分のみ
                          OpenAI text-embedding-3-small
                                        ↓
                     Neon Postgres EvidenceChunk (pgvector, sourceType/category/keywords付き)
                                        ↓
        ┌───────────────────────────────┴───────────────────────────────┐
  nano FC（グローバル検索: pinned優先→category一致優先→類似度順）   記事生成CLI（争点追加時）
```

**旧設計との最大の違い**: 従来は`IssueLawLink`で明示的に紐付けた争点だけがFCの根拠を持てたため、
Radarが自動公開する争点（1日8件ペース）は誰も法令を紐付けず根拠ゼロだった。
`EvidenceChunk`は`category`（IssueCategory配列）を持ち、`retrieveChunks()`（`src/lib/rag.ts`）は
**争点へのpinned優先＋isActiveな全EvidenceChunkからのグローバル検索＋category一致ブースト**に変更した。
これにより法令DBさえ育てれば、争点ごとの手動リンク作業なしに全争点でFCが機能する。

## コスト設計

- ハッシュ比較で**変更のないチャンクはembedding再生成しない**（差分のみ課金）
- embedding: text-embedding-3-small = $0.02/1Mトークン。法令1本(10万字) ≈ ¥1以下
- 国会会議録: キーワードに一致する発言のみ取り込む（全会議録は取らない）
- **「日本の全法令」は目指さない**。政治議論で実際に引用される範囲（`registry.json`に約35本を初期シード）を優先的に増やす

## 運用フロー

### 法令・会議録を追加するとき
```bash
# 1. 法令を取り込む（法令名で指定。IDはe-Gov APIが自動解決）
python scripts/ingest/fetch_egov.py --law-title 公職選挙法 --category POLITICS LAW --keywords 選挙 投票

# 2. 国会の関連発言を取り込む
python scripts/ingest/fetch_kokkai.py --keyword "選挙制度" --category POLITICS --max 50

# 3. 条約・歴史文書（公式APIなし・人間が原文を用意）
python scripts/ingest/fetch_manual.py --source ./sources/manual/nihonkoku-kenpo.txt \
  --source-name "日本国憲法" --source-url "https://laws.e-gov.go.jp/law/321CONSTITUTION" \
  --source-type HISTORICAL_DOC --category POLITICS LAW --keywords 憲法 基本的人権

# 4. embedding生成 + DB投入（差分のみ）
python scripts/ingest/embed_upsert.py
```
`--issue-slug`を付けると`IssueEvidenceLink`が`pinned=true`で張られ、その争点で最優先の根拠になる（任意。無くてもグローバル検索で拾われる）。

### 週次メンテ（完全自動・GitHub Actions）

`.github/workflows/refresh-data.yml` が毎週月曜6:00 JSTに実行:

1. `sync-trending-keywords.ts` — Radarが自動公開しmonitoringUntil内の争点から、未登録のものを`kokkai_keywords`に自動追加
2. `refresh.py`:
   - `sources/registry.json` の法令 → e-Gov APIで改正チェック（本文は取らない=無料。law_title未解決の新規エントリはここでlaw_idを解決）
   - 国会キーワード → 前回取得日以降の新規発言のみ（**閉会中は自動的に0件=¥0**）
   - 変更があった分だけ embedding → Neon upsert
   - **改正で消えた条文は isActive=false**（廃止条文を根拠にFCさせない）
   - **根拠が変わった争点のFCキャッシュを自動削除**（次のタップで最新根拠により再判定）
3. registry.json の更新を自動コミット

必要なGitHub Secrets: `DIRECT_URL`（Neon direct接続）, `OPENAI_API_KEY`

コスト実績の見積り:
- 変化なしの週: ¥0（APIチェックのみ）
- 法令1本改正の週: embedding数円 + FCキャッシュ再判定は利用者のタップ時に¥0.01/件
- GitHub Actions: 無料枠内（週1回×数分）

## セットアップ

```bash
cd scripts/ingest
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# DATABASE_URL(direct接続) と OPENAI_API_KEY を環境変数に
```

## チャンク化の設計判断

- **条単位**で分割（第X条）。600字を超える条は項単位に再分割
- チャンクに必ず `sourceName` + `articleRef` + `sourceUrl`（e-Govの該当法令URL等）を持たせる
  → FCの判定結果に「消費税法 第29条」と正確な出典を出せる
- 会議録チャンクは「発言者・所属・日付・会議名」をtextの先頭に埋め込む
  → nanoが「誰がいつ言ったか」を判定根拠にできる
- 条約・歴史文書はAIに本文を書かせない。人間が公式原文を用意し、AIはchunk分割のみ提案（法令と同じ厳格さ）

## 未実装（次フェーズ）

- **判例（裁判所の判決文）**: 公式APIがなくスクレイピングが必要。`EvidenceSourceType.COURT_RULING`は型として用意済み
- **統計データの自動取り込み・数値ファクトチェック**: `StatisticSeries`/`StatisticPoint`はスキーマのみ用意。e-Stat REST API（RSS通知は2023年9月終了だが集計表取得APIは現役）・日銀時系列統計からの取り込みと、数値主張を検証する専用ロジックは別タスク
