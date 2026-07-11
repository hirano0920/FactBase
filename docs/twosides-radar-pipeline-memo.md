# TwoSides Radar パイプライン方針メモ

> 2026-07-08 構想セッションの結論。`docs/twosides-concept.md` の north star を、Radar 実装・運用に落としたもの。

---

## 0. プロダクトの芯（FactBase → TwoSides）

- **記事の役割**: 真理の確定ではなく、**議論が成立する共通の土台**（火をつける導火線）
- **主役**: スプリットスレッド。良い意見が育つ場
- **素材**: 一次情報があれば加点。必須ではない。**多ソース統合 + 出典種別ラベル + 一致点/相違点の整理**
- **YouTube**: 動画本文は取らない。バズ検知のシグナル。本文は **各局ニュースサイト** から取得（ANN/TBS/FNN/日テレ/NHK 等は速報で動画と同系統の記事を出すことが多い）

---

## 1. 理想フロー

```
バズ検知
  → どれを記事にするか精査
  → 決定した話題で多ソース収集
  → 中立要約（煽り・不安増幅ではなく「話したくなる論点」）
  → 出典まとめ + ソース種別ラベル
  → 公開（シェア用タイトル + 投票用設問）
  → スプリットスレッド
```

---

## 2. 現状コードとの対応

| ステップ | 現状 | 備考 |
|---|---|---|
| バズ検知 | `discover.ts` | Trends / Yahoo RT / ニュース（国内・経済・国際・**エンタメ**）/ YouTube。Yahooに「社会」カテゴリは無い（/society は404） |
| 精査 | mini `filterRelevantTopics` + `promote-logic` | **賛否を取れる火種**（debatable=立場を取れるか）。一次情報は必須ではない |
| 情報集め | `researchTopic()` + `fetchReportExcerpts` | 国内・海外・Wiki・官庁・Tavily 補完 |
| 要約 | `generateVerifiedArticle()` | **FactBase 寄り（安全第一）→ TwoSides 火種モードへ寄せる** |
| 公開 | `promote.ts` | ピーク3回/日 |

**パイプライン整理（2026-07-10）**

- **本番 cron**: `discover → promote` のみ（調査7回/日 + 投稿ピーク3回/日）
- **停止**: `detect` / `summarize` / `followup` は cron から外した（コスト削減・品質一本化）。スクリプトは残置・手動実行可
- 次: 選別・記事プロンプトを TwoSides「賛否を取れる火種」向けに最適化

---

## 3. 議論適性 — AI だけに任せない

### 定義

「メディアが食い違っているか」ではない。  
**「読んだ一般ユーザーが賛否・評価の立場を取れるか」** が本体。

### 必須に **しない** もの（2026-07-08 修正）

- 国内 **かつ** 海外の両方
- 報道抜粋間の「食い違いキーワード」（裁判・事件系は各社同型の慎重表現が普通 → 名誉毀損リスクも）
- Wikipedia 背景・公式声明（**常に試す / あれば加点**。ゲート条件にしない）

### 必須・主判定

| シグナル | 役割 |
|---|---|
| `distinctNewsOutlets >= 2` | 単一ソーススクープ回避 |
| 本文抜粋が取れる国内報道 | 実際に書ける |
| `debatable`（立場を取れる争点か） | ソフト乗数（後述） |

### 3 段階ハイブリッド

1. **事前（AI）**: 既存 `filterRelevantTopics` に `debatable: boolean` + 理由を追加。通過/不通過の唯一条件に **しない**
2. **事後（ルール・メイン）**: 上表。海外は加点のみ
3. **ボーダーのみ（AI）**: 「一般読者が賛成/反対/わからないを選べるか？」yes/no。**「報道が食い違うか」は聞かない**

### promote 選定式（2026-07-10）

```
eligible = (buzz≥min ∧ 証拠十分) ∨ mediaConsensus
         ∧ debatable≠false
         ∧ debateType ∈ {declaration, policy, org_response, norm_flare, indicator, geopolitics}

優先度 = buzzScore × (debatable===false ? 0.4 : 1) × min(1, outlets/2)
       + debateTypeボーナス（declaration+2.5(+0.5 if 3媒体), org/norm+1, 他+0.25）
```

旧 PENDING は `debateType` 欠落時に機械推定（`inferDebateType`）。推定不能・速報未確定は出さない。

記事は `debateTypeArticleHint` で型別の両側見出し・書き方を Writer に注入。

---

## 4. 記事・タイトル（TwoSides 火種モード）

### 記事構成（REPORTED バズ向け・実装済み 2026-07-10）

1. 何が起きているか（共通事実）
2. 報道の共通点 / 相違点（差があるときだけ厚く）
3. 背景・経緯 / 法令 / 国内外比較（あれば）
4. **対立の軸**（争点タイプ可変ラベル）
5. **賛成 / 反対の主な理由**（厚め・最重要）
6. 確認できないこと・次に見る情報（短く）
7. 出典

### 記事の使命（2026-07-10）

スプリットスレッド参加者への**最低限の中立土台**。長文まとめ・偏向報道にしない。
- 国内主 → 国内メディアのみ
- 海外主（戦争・外交等）→ 海外報道も使い、両立場を対になる見出しで見せる
- 声明対立は当事者名ラベル。賛否の無理当て禁止

### タイトル 2 層（案）

| 用途 | 例 |
|---|---|
| `shareTitle`（OG / X / カード） | バズりやすいが煽らないフック |
| `voteQuestion`（争点ページ・投票） | 中立な設問（既存 `filterRelevantTopics` の question） |

---

## 5. YouTube → 各局記事 URL 自動マッチ（未実装・合意済み）

```
YouTube バズタイトル（検知のみ）
  → topic 正規化（filterRelevantTopics）
  → Google News / 既存検索
  → ドメイン優先:
       news.tv-asahi.co.jp
       newsdig.tbs.co.jp
       fnn.jp
       news.ntv.co.jp
       nhk.or.jp / news.web.nhk
  → buzzTitleMatch で同一争点判定
  → sourceUrls に追加 → fetchReportExcerpts
```

Gemini / 動画要約 API は **不要**（Azure GPT-5 のまま）。

---

## 6. 実装優先順位（合意）

1. **YouTube → 各局記事マッチ**（`research.ts` または `match-broadcast-articles.ts`）
2. **`TOPIC_FILTER_PROMPT` に `debatable` 追加**
3. **promote 選定から海外/食い違い/background 必須を外す** + 上記優先度式
4. **`radar-article.ts` TwoSides 火種プロンプト**（論点セクション厚め）
5. **`shareTitle` 2 層化**（`promote.ts` + OG）
6. **パイプライン整理**（バズ系は discover→promote のみ明文化）

---

## 7. 明示的にやらない

- 議論適性を AI 単独のハードゲートにする
- 海外必須 / 報道食い違い必須 / Wiki 必須
- YouTube 動画本文の取得（Gemini URL 投入含む）— 各局 Web 記事で代替
- 不安煽り・扇動を目的にしたタイトル/リード

---

_最終更新: 2026-07-08_
