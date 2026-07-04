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
| e-Gov法令 | **公式API v2**（XML/JSON） | 争点追加時 + 週次差分 | `scripts/ingest/fetch_egov.py` |
| 国会会議録 | **国立国会図書館 公式API** | 国会中: 日次 / 閉会: 停止 | `scripts/ingest/fetch_kokkai.py` |
| 政治資金収支報告 | 総務省PDF → pdfplumberで抽出 | 公開時（年1〜2回）手動 | Phase 2で実装 |
| 政党公約 | 手動投入（選挙期のみ） | 選挙期 | `sources/` にテキスト保存 |

公式APIを使う理由:
- 利用規約上クリーン（e-Gov API・国会会議録APIは公開データの機械取得を想定した提供）
- HTML構造変更に壊されない
- 出典URLが正規に作れる（FCの「必ず出典リンク」要件）

## アーキテクチャ

```
[e-Gov API] ─┐
[国会会議録API] ─┼→ fetch_*.py → チャンク化(200〜600字) → SHA256ハッシュ
[政治資金PDF] ─┘                        ↓
                          既存ハッシュと比較（変更なし→skip、¥0）
                                        ↓ 変更分のみ
                          OpenAI text-embedding-3-small
                                        ↓
                          Neon Postgres LawChunk (pgvector)
                                        ↓
                    ┌───────────┴───────────┐
              nano FC (RAG検索)      Sonnet記事生成（争点追加時）
```

## コスト設計

- ハッシュ比較で**変更のないチャンクはembedding再生成しない**（差分のみ課金）
- embedding: text-embedding-3-small = $0.02/1Mトークン。法令1本(10万字) ≈ ¥1以下
- 国会会議録: 争点キーワードに一致する発言のみ取り込む（全会議録は取らない）
- **全部常時最新にしない**。争点に必要なコーパスだけ追加（仕様書どおり）

## 運用フロー

### 争点を追加するとき（週45分の中心作業）
```bash
# 1. 法令を取り込む（法令番号は e-Gov で検索）
python scripts/ingest/fetch_egov.py --law-id 363AC0000000108 --issue-slug consumption-tax

# 2. 国会の関連発言を取り込む
python scripts/ingest/fetch_kokkai.py --keyword "消費税 減税" --from 2026-01-01 --issue-slug consumption-tax --max 50

# 3. embedding生成 + DB投入（差分のみ）
python scripts/ingest/embed_upsert.py

# 4. Sonnetで記事生成（既存のCLI）
npm run article -- --slug consumption-tax --title "..." --category POLITICS --source ./sources/consumption-tax.txt
```

### 週次メンテ（完全自動・GitHub Actions）

`.github/workflows/refresh-data.yml` が毎週月曜6:00 JSTに `refresh.py` を実行:

1. `sources/registry.json` の法令 → e-Gov APIで改正チェック（本文は取らない=無料）
2. 国会キーワード → 前回取得日以降の新規発言のみ（**閉会中は自動的に0件=¥0**）
3. 変更があった分だけ embedding → Neon upsert
4. **改正で消えた条文は isActive=false**（廃止条文を根拠にFCさせない）
5. **根拠が変わった争点のFCキャッシュを自動削除**（次のタップで最新根拠により再判定）
6. registry.json の更新を自動コミット

必要なGitHub Secrets: `DIRECT_URL`（Neon direct接続）, `OPENAI_API_KEY`

**争点を増やしたら registry.json に1エントリ追加するだけ**で自動更新の対象になる。
週次の人間の作業: Actionsの実行ログを眺める（1分）。

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

## 法令チャンク化の設計判断

- **条単位**で分割（第X条）。600字を超える条は項単位に再分割
- チャンクに必ず `lawName` + `articleRef` + `sourceUrl`（e-Govの該当法令URL）を持たせる
  → FCの判定結果に「消費税法 第29条」と正確な出典を出せる
- 会議録チャンクは「発言者・所属・日付・会議名」をtextの先頭に埋め込む
  → nanoが「誰がいつ言ったか」を判定根拠にできる
