# Radar 選抜パイプライン最終版（Selection V2）— **本番換装済み**

**実装状態（2026-07-16）**: 公開は **両論Gate（fail-closed）∧ Buzz'≥BUZZ_MIN ∧ Heat'≥HEAT_MIN ∧ rankScore≥RANK_MIN**。`rankScore = Buzz'×Heat'×DVS'`（DVS不明は×1）。日次キャッチアップ廃止。Yahoo RTは政治専用ではなくサイト適合（時事・社会・生活争点）を収集。

**目的**: バズっている × 盛り上がっている × 両論・対立がはっきりしているトピックだけを拾い、ソースを集めて記事化する。  
**非目的（Phase 1）**: 1日9本の達成、記事プロンプトの磨き込み、キーワードで「生活影響」を採点すること。

**製品上の優先順位**:
1. 超特大バズ＋盛り上がり＋両論が立つ1本を確実に拾う（コメントが回る）
2. カスを埋めて本数を稼がない
3. 将来的に「同じ基準で質の高いものを最大9本」まで伸ばす（今は追わない）

---

## 0. 設計原則（これ以外は捨てる）

反論を封じるために、スコアとゲートは次の原則だけに従う。

| # | 原則 | 意味 |
|---|------|------|
| P1 | **Gate と Rank を分ける** | 「公開してよいか」と「どれを先に出すか」を混ぜない |
| P2 | **測れるものだけを点数にする** | LLMに0〜5を付けさせない。抽出・判定は可、採点は観測値のみ |
| P3 | **同じ現象を二重計上しない** | 例: コメントランキングを buzz と heat の両方で満額加点しない |
| P4 | **掛け算（積）で並べる** | 「バズだけ強い」「熱量だけある」が上位に来ない |
| P5 | **無いデータは捏造しない** | 投票が無い＝分断度0ではない。その次元は「不明」として扱い、他の実測で補う |
| P6 | **高いコストの前で落とす** | Writer（最大コスト）の前に Gate。調査（中コスト）は広く残す |
| P7 | **本数目標で閾値を下げない** | 枠が空いても次点カスを押し上げない |

---

## 運用コマンド

```bash
# 旧加算 vs V2 比較
npx tsx scripts/radar/compare-selection-v2.ts
npx tsx scripts/radar/compare-selection-v2.ts --demo

# PENDING に tweetCount を突合保存
npx tsx scripts/radar/backfill-tweet-count.ts

# discover（ローカルは env 必須）
node --env-file=.env.local --import tsx scripts/radar/discover.ts --force
```

詳細なスコア式・Gate定義は本ドキュメント後半および `scripts/radar/lib/selection-v2.ts` を参照。


---

## 1. パイプライン最終形

```
┌─────────────────────────────────────────────────────────────┐
│ DISCOVER（広く・安く）                                         │
│                                                               │
│ ① 収集（無料）                                                 │
│    Google Trends / Yahoo RT(+tweetCount) / Yahoo News         │
│    / Yahoo Comment Ranking / YouTube                          │
│                                                               │
│ ② 粗フィルタ（nano・1回・安い）                                 │
│    relevant / debatable / debateType / 仮設問                  │
│    ※ ここでは「落とす」だけ。採点しない。pro/con抽出しない。      │
│                                                               │
│ ③ 調査（中コスト・広め）                                        │
│    国会・法令・ニュース・海外・投票マッチ・コメント数             │
│    evidence に tweetCount も保存                               │
│    ※ Vitality不足で調査スキップしない（情報不足で誤爆するため）   │
└───────────────────────────┬─────────────────────────────────┘
                            │ PENDING 候補
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ PROMOTE（狭く・高く）                                          │
│                                                               │
│ ④ 抜粋取得（ネットワークのみ・LLM課金なし）                      │
│    薄い抜粋 → HELD（Writerに進まない）                          │
│                                                               │
│ ⑤ Gate（公開可否・ハード）※ すべて Writer 前                     │
│    G1 証拠十分（既存 evaluateBuzzPromoteSufficiency）            │
│    G2 書けるか（assessEvidenceWriteability）                   │
│    G3 両論が立つか（assessDebateLegitimacy・抜粋後）            │
│    G4 一方的すぎない（isLopsidedWithoutHeat・投票がある場合のみ） │
│    どれか NG → HELD。Rank に載せない。Writer 呼ばない。          │
│                                                               │
│ ⑥ Rank（並び順・ソフト）                                        │
│    score = Buzz' × Heat'                                       │
│    高い順にピーク枠へ（閾値未満は出さない）                        │
│                                                               │
│ ⑦ Writer + 品質ゲート（最大コスト・ここまで通ったものだけ）       │
│                                                               │
│ ⑧ 公開（硬上限のみ残す。最低本数のキャッチアップは廃止）          │
└─────────────────────────────────────────────────────────────┘
```

### 意図的にやらないこと（反論への先回り）

| やらない | 理由 |
|----------|------|
| discover②で pro/con 抽出して調査スキップ | 見出しだけでは幻覚。良い争点を落とす |
| nanoに A/B/C を0〜5採点させる | 再現性がなく、プロンプト次第でブレる |
| キーワードで「生活影響スコア」 | GPIF等を取りこぼし、タバコ値上げを過大評価する |
| buzz + 小さなボーナスの加算式 | 露出が支配的になり「争点の後付け」が残る |
| 最低7本/できれば9本のキャッチアップ | 枠埋めのために次点カスを公開してしまう |
| 軸の連続スコアを Rank に混ぜる | Gateで「立つ/立たない」を見たあと、弱い連続値を足すと二重判定 |

---

## 2. Gate（公開可否）— 「争点が後付けでない」保証

Gateは **並べ替えではなく足切り**。通ったものだけが「両論記事として成立する」。

### G1 証拠十分（既存・機械）
- 複数媒体・一次情報など、記事を書ける材料があるか
- 失敗 → HELD `insufficient_evidence`

### G2 書けるか（既存・nano・抜粋後）
- 抜粋が同じ角度の事実羅列だけで両論が書けない、等
- 失敗 → HELD `writeability_rejected`
- 失敗時は fail-open にしない（薄い記事を出さないため fail-closed）

### G3 両論正当性（抜粋後・fail-closed）
- `assessDebateLegitimacy`: bad_frame / obvious_truth / fact_only / no_opposing_side / unacceptable_side
- **必ず十分な抜粋を渡す**（空・極端に短い抜粋は API を呼ばず即 NG。トピック名だけでは判定させない）
- API失敗・JSON不正も **通さない**（fail-closed）
- 失敗 → HELD `debate_legitimacy_rejected`
- ここが「争点を後からくっつけない」本丸

### G4 一方的すぎる投票（既存・条件付き）
- Yahoo投票があり、ほぼ全会一致かつコメント熱も無い → スレッドが盛り上がらない
- 投票が無い場合は **適用しない**（P5: データ無しを一方的と決めつけない）

**Gate通過 = 「ソース上、両論が書ける争点である」**  
これ以上の「争点の良さ」は Rank では見ない（測れないものを点数にしない）。

---

## 3. Rank（並び順）— 反論不能にするための式

### 3.1 なぜ加算ではなく積か

加算（現状に近い形）:
```
score ≈ buzz×α + heat×β + ...
```
→ buzz が大きいだけで上位に残る。ユーザーが嫌った「露出だけ拾って争点は後付け」が残る。

積:
```
score = Buzz' × Heat'
```
→ **どちらかが弱いと順位が沈む**。「バズってるが誰も議論してない」「議論はあるが露出が無い」は自然に下がる。

これは製品定義そのもの:
> バズ × 盛り上がり ×（両論は Gate で保証）

### 3.2 正規化（0〜1）

#### Buzz'（露出・クロスソース）

既存 `effectiveScore`（0〜5）を使う。中身は:
- Trends / Yahoo RT / News / YouTube の一致（各0/1）
- ニュース複数見出し・コメントランキングは別枠+1（既存）

```
Buzz' = clamp(effectiveScore / 5, 0, 1)
```

**反論への答え**: 「なぜ buzzScore を捨てない？」→ 捨てない。露出は必要。ただし **単独では上位に来られない**（積だから）。

#### Heat'（盛り上がり）

タイムリーさの優先順位:

| 優先 | シグナル | 性質 |
|------|----------|------|
| 1 | Yahoo RT `tweetCount`（X投稿量） | 速報に強い |
| 2 | 記事コメント数 / 急増 / YouTube返信 | 「議論が付いた」実測 |

```
# 主熱量（対数圧縮。件数の生値が桁違いでも破綻しない）
TweetHeat = log1p(tweetCount) / log1p(TWEET_REF)

# 副熱量（コメント量のみ。分断は DVS' へ）
CommentHeat = 0
  if commentCountSurge: += 0.4
  if commentCount >= 3000: += 0.35
  elif commentCount >= 1000: += 0.3
  elif commentCount >= 500: += 0.2
  elif commentCount >= 300: += 0.12
  (+ YouTube reply 加点)
CommentHeat = min(CommentHeat, 1.0)

if tweetCount > 0:
  Heat' = min(1.0, 0.85 * TweetHeat + 0.15 * CommentHeat)
else:
  Heat' = min(0.55, CommentHeat)
```

#### DVS'（分断・独立因子）

```
if 分断シグナル無し: DVS' = 1   # 不明はペナルティなし
else: DVS' = max(DVS_SOFT_FLOOR, resolveDivisionScore)
```

### 3.3 最終スコア

```
rankScore = Buzz' × Heat' × DVS'
```

- **DVS'**: 投票/コメント摩擦/スタンス/予測の分断度。**不明は 1（ペナルティなし）**。測れたときだけ並びを動かす。
- 分断度は Heat' に二重計上しない（副熱量はコメント量のみ）。

並び順はこの値の降順のみ。  
カテゴリ偏り制限（既存 `maxSameCategoryPerPromoteWindow`）は維持してよい（独占防止。質の定義とは独立）。

### 3.4 公開閾値（本数埋め禁止）

```
publishable = 両論Gate通過
            AND Buzz'  >= BUZZ_MIN   （既定 0.4 ≒ effectiveScore≥2）
            AND Heat'  >= HEAT_MIN   （既定 0.15）
            AND rankScore >= RANK_MIN （既定 0.12）
```

- 3下限＋両論Gateのいずれか欠ければピーク枠が空いていても **出さない**
- 1ピークの上限本数は残す（洪水防止）が、**下限本数は持たない**
- 日次: `dailyPublishHardCap` のみ残す。`minTarget` / soft キャッチアップは廃止または無効化
- 実装: `passesSelectionV2` + `assessDebateLegitimacy`（抜粋空・API失敗は fail-closed）

**反論への答え**: 「1本も出ない日があるのでは？」→ ある。それが正しい。カス9本より無の方が製品としてマシ（ユーザー確定方針）。

---

## 4. コスト合理化（何を削り、何を残すか）

| 工程 | コスト | V2の扱い |
|------|--------|----------|
| ① 収集 | 無料 | 残す。tweetCountを保存するだけ追加 |
| ② nano粗フィルタ | 低 | 残す（軽く保つ）。採点を足さない |
| ③ research | 中 | **残す（広め）**。ここで削ると誤爆する |
| ④ 抜粋 | ネットワーク | 残す。薄いものは即HELD |
| ⑤ Gate | nano数回 | Writerより桁で安い。**必須** |
| ⑥ Rank | 無料 | 積スコア |
| ⑦ Writer | **最大** | Gate+閾値通過のみ → **ここが削れる本丸** |

「調査を減らしてコスト削減」は **採用しない**。  
削減対象は常に **Writer呼び出し回数**。

---

## 5. 既存部品との対応（実装マッピング）

| V2概念 | 既存コード | 変更 |
|--------|------------|------|
| tweetCount収集 | `yahoo-realtime.ts` 既存 | `evidenceJson` へ保存する配線を追加 |
| Buzz' | `assembleBuzzScore` / `effectiveScore` | 正規化して Rank に使う |
| Heat' | 一部 `commentIntensityBonus` / `divisionScoreBonus` | **tweetCount主の Heat' に置換**。加算ボーナス式は廃止 |
| Gate G3 | `assessDebateLegitimacy` | 抜粋必須・Writer前を厳守（既にpromoteにある） |
| Rank式 | `weightedPromoteScore` | **Buzz'×Heat' に置換** |
| 本数 | `daily-quota.ts` | キャッチアップ廃止、閾値未満は0本可 |
| 軸の連続Vitality | （未実装・採用せず） | Gateの二値判定に一本化 |

---

## 6. 「完璧さ」の定義（何をもって反論不能とするか）

この設計が主張するのは次の命題だけである。

1. **両論がソース上立たないものは出さない**（Gate。LLM採点ではなく抜粋ベースの正当性判定）
2. **露出と熱量の両方で強いものだけが上位**（積。片方だけでは勝てない）
3. **熱量の本命はタイムリーなSNS投稿量**（tweetCount。遅行指標は副）
4. **測れないものは点数にしない**（生活影響キーワード、nanoの0〜5点は不採用）
5. **最大コストの前で落とす**（Writer前Gate）
6. **本数のために閾値を下げない**

これ以外の「もっと良い争点」の微差（減税の設計論が深いか等）は、Phase 1では **記事品質・プロンプト側**の問題として分離する。選抜レイヤで無理に採点しない。

---

## 7. Phase 1 実装順序

1. `tweetCount` を evidence に保存
2. `Heat'` / `Buzz'` / `rankScore = Buzz'×Heat'` を実装し `weightedPromoteScore` を置換
3. 公開閾値 `RANK_MIN` を導入（初期は低め→実データで上げる）
4. daily quota の最低本数キャッチアップを無効化
5. Gate（legitimacy等）の順序と fail 方針を確認・テスト固定
6. 実ランの HELD理由＋上位スコアを見て `TWEET_REF` / `RANK_MIN` を校正

**まだやらない**: 記事プロンプト、見出し、投票設問の磨き、9本達成。

---

## 8. 成功指標（Phase 1）

| 指標 | 見方 |
|------|------|
| Writer呼び出しあたりの公開率 | 上がる（カス候補を前段で落とす） |
| 公開記事の平均 Heat'/Buzz' | 「露出だけ」記事が減る |
| HELD `debate_legitimacy_rejected` | 正しくゴミを止めているか |
| 「コメントが回る1本」の体感 | 手動で上位を見て判定（最終審判） |

---

## 9. 一言でいう最終版

> **広く調べ、抜粋で両論ゲートを通し、バズ×SNS熱の積で並べ、閾値未満は出さない。本数は追わない。**

これが Selection V2 の全体である。
