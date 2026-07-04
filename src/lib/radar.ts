/**
 * FactBase Radar — スコアリングと公開判断の純関数。
 * 公開判断は HotScore × TrustScore − RiskScore。ただし安全ゲートが最優先:
 * ハードブロック該当は点数に関係なく必ずHELD（人間確認必須）。
 */

export interface ClusterInput {
  /** クラスタ内の見出し数 */
  eventCount: number;
  /** 一致した独立メディア数（複数媒体一致が信頼シグナル） */
  distinctFeeds: number;
  /** 最新イベントからの経過分 */
  minutesSinceLatest: number;
  /** クラスタ内フィードの最大信頼度 20-100 */
  maxTrustWeight: number;
  /** nano分類が返した危険シグナル */
  riskFlags: string[];
}

/**
 * 自動公開を絶対にしない危険シグナル（仕様の「自動公開禁止」）。
 * nano分類のflagsと突き合わせる。1つでも該当→HELD。
 */
export const HARD_BLOCK_FLAGS = [
  "private_individual", // 一般人の個人名
  "sexual_crime", // 性犯罪疑惑
  "minor", // 未成年
  "suicide_or_victim", // 自殺・被害者情報
  "discrimination", // 差別煽動
  "unverified_crime_assertion", // 真偽不明の犯罪断定
] as const;

/** 減点対象（公開は可能だがスコアを下げる） */
const SOFT_RISK_WEIGHTS: Record<string, number> = {
  named_politician_allegation: 30, // 政治家個人への疑惑（報道ベースラベル必須）
  crime_related: 20,
  foreign_conflict: 10,
  health_medical: 15,
};

export function hotScore(c: ClusterInput): number {
  const volume = Math.min(c.eventCount * 10, 50);
  const spread = Math.min(c.distinctFeeds * 15, 45); // 複数媒体一致を重視
  const recency =
    c.minutesSinceLatest <= 30 ? 30 : c.minutesSinceLatest <= 120 ? 15 : 0;
  return volume + spread + recency; // 0-125
}

export function trustScore(c: ClusterInput): number {
  return Math.max(20, Math.min(100, c.maxTrustWeight));
}

export function riskScore(c: ClusterInput): number {
  let score = 0;
  for (const flag of c.riskFlags) {
    if ((HARD_BLOCK_FLAGS as readonly string[]).includes(flag)) score += 100;
    else score += SOFT_RISK_WEIGHTS[flag] ?? 10;
  }
  return score;
}

export type PublishDecision =
  | { action: "publish"; confirmation: "OFFICIAL" | "REPORTED"; score: number; reason: string }
  | { action: "hold"; score: number; reason: string }
  | { action: "reject"; score: number; reason: string };

export interface DecisionInput extends ClusterInput {
  classification: string; // official / report / scandal / incident / indicator
  /** 本日すでに自動公開した件数 */
  publishedToday: number;
  /** 日次自動公開上限 */
  dailyLimit: number;
}

const PUBLISH_THRESHOLD = 45;

export function decidePublish(input: DecisionInput): PublishDecision {
  const hot = hotScore(input);
  const trust = trustScore(input);
  const risk = riskScore(input);
  // 正規化: hot(0-125) × trust(0.2-1.0) − risk
  const score = Math.round((hot * trust) / 100 - risk);
  const detail = `hot=${hot} trust=${trust} risk=${risk} score=${score}`;

  // 1. ハードブロックは点数に関係なく必ず人間確認
  const blocked = input.riskFlags.filter((f) =>
    (HARD_BLOCK_FLAGS as readonly string[]).includes(f),
  );
  if (blocked.length > 0) {
    return { action: "hold", score, reason: `hard_block:${blocked.join(",")} ${detail}` };
  }

  // 2. 単一媒体のみのスクープ系は誤報リスクが高い→複数媒体一致まで待つ
  if (input.distinctFeeds < 2 && input.classification !== "official") {
    return { action: "reject", score, reason: `single_source ${detail}` };
  }

  // 3. スコア閾値
  if (score < PUBLISH_THRESHOLD) {
    return { action: "reject", score, reason: `below_threshold ${detail}` };
  }

  // 4. 日次上限（コスト暴走・低品質乱発の防止）
  if (input.publishedToday >= input.dailyLimit) {
    return { action: "hold", score, reason: `daily_limit ${detail}` };
  }

  // 5. 公開。公式系はOFFICIAL、それ以外は必ずREPORTED（真偽未確認ラベル）
  const confirmation =
    input.classification === "official" || input.classification === "indicator"
      ? "OFFICIAL"
      : "REPORTED";
  return { action: "publish", confirmation, score, reason: detail };
}

/** タイトル正規化（同一トピック再検知の防止キー） */
export function dedupKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[「」『』【】（）()［］\[\]、。・:：,，.\s]/g, "")
    .slice(0, 60);
}

/**
 * クラスタ整合性チェック。
 *
 * 「複数媒体一致」はnanoのクラスタリング結果を信用しているだけで、機械的な裏取りではない。
 * nanoが無関係な見出しを1クラスタにまとめてしまうと、実際は単一ソースの誤報なのに
 * distinctFeeds=3のように見えてスコアが不当に高くなる（誤報の自動公開リスク）。
 *
 * ここでは文字bigramのJaccard類似度でクラスタ内タイトルの一貫性を機械的に再検証し、
 * nanoの判断が壊れているクラスタを検出する。日本語は分かち書きがないため文字bigramを使う。
 */
function bigrams(text: string): Set<string> {
  const clean = text.replace(/\s+/g, "");
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** クラスタ内タイトルの平均類似度（0-1）。低いほど「実は別の出来事」の疑いが強い。 */
export function clusterCoherence(titles: string[]): number {
  if (titles.length <= 1) return 1; // 単体は比較不能なのでそのまま通す
  const sets = titles.map(bigrams);
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      total += jaccard(sets[i], sets[j]);
      pairs++;
    }
  }
  return pairs === 0 ? 1 : total / pairs;
}

/** この類似度未満なら「nanoが無関係な見出しを誤って束ねた」とみなす */
export const COHERENCE_THRESHOLD = 0.12;
