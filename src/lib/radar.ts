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

/** 政治・経済・法律等の議論スレに載せない話題（1つでも該当→reject） */
export const OUT_OF_SCOPE_FLAGS = [
  "sports_entertainment",
  "celebrity_gossip",
  "pure_weather",
  "pure_science",
] as const;

/** 見出しからスポーツ・エンタメ・科学速報等を機械検出（nano漏れの保険） */
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /ワールドカップ|w杯|world\s*cup|fifa/i,
  /サッカー|soccer|football|プレミア|チャンピオンズリーグ|ucl/i,
  /(試合|ゲーム).{0,8}(結果|終了|勝利|敗北|引き分け)/,
  /\d+\s*[-–—]\s*\d+.*(勝|敗|試合)/,
  /nba|nfl|mlb|nhl|wbc|大谷|本塁打|ホームラン|アシスト|得点王/i,
  /アイドル|芸能|結婚|離婚|不倫|ゴシップ/i,
  /天気予報|週間天気/,
  /はやぶさ|hayabusa|小惑星|探査機|jaxa|宇宙ステーション|ロケット打ち上げ|天文/i,
];

/** 政策・外交・予算・宇宙政策など「議論すべき角度」があれば除外パターンでも通す */
const IN_SCOPE_OVERRIDE = /予算|法案|政策|国会|省|内閣|外交|安保|入管|規制|補助金|パリ協定|制裁|条約|宇宙基本/i;

/** 省庁・中央銀行・国会・裁判所など一次情報フィード（feeds.json と同期） */
export const PRIMARY_SOURCE_FEED =
  /^(kantei|cao|digital|boj-|mof|fsa|moj-|mhlw|mlit-|maff|mod-|mofa-|fed-|ecb-|courts|shugiin|sangiin|whitehouse|state-|defense-gov|eu-commission|un-|iaea|who-)/;

/** 速報LIVE対象（戦争・テロ・重大事件）。報道のみでも可だが続報前提 */
const BREAKING_KEYWORDS =
  /暗殺|テロ|爆発|砲撃|空爆|侵攻|開戦|銃撃|襲撃|mass\s*shooting|assassination|airstrike|invasion|terror|missile\s*strike|casualties|killed|deadly/i;

/** 速報として扱う最大経過分（これより古い incident は見送り） */
export const BREAKING_MAX_AGE_MIN = 360;

export function isOutOfScopeTopic(clusterTitle: string, memberTitles: string[]): boolean {
  const blob = [clusterTitle, ...memberTitles].join("\n");
  if (IN_SCOPE_OVERRIDE.test(blob)) return false;
  return OUT_OF_SCOPE_PATTERNS.some((p) => p.test(blob));
}

export function hasPrimarySource(input: DecisionInput): boolean {
  if (input.classification === "official" || input.classification === "indicator") return true;
  return (input.feedNames ?? []).some((f) => PRIMARY_SOURCE_FEED.test(f));
}

export function isBreakingNews(input: DecisionInput): boolean {
  if (input.classification !== "incident") return false;
  if (input.distinctFeeds < 2) return false;
  if (input.minutesSinceLatest > BREAKING_MAX_AGE_MIN) return false;
  const flagged =
    input.riskFlags.includes("foreign_conflict") || input.riskFlags.includes("crime_related");
  const blob = input.clusterTitle ?? "";
  return flagged || BREAKING_KEYWORDS.test(blob);
}

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
  /** クラスタ内フィード名（一次情報判定） */
  feedNames?: string[];
  /** クラスタタイトル（速報キーワード判定） */
  clusterTitle?: string;
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

  // 1b. スポーツ・エンタメ等は議論スレの対象外
  const outOfScope = input.riskFlags.filter((f) =>
    (OUT_OF_SCOPE_FLAGS as readonly string[]).includes(f),
  );
  if (outOfScope.length > 0) {
    return { action: "reject", score, reason: `out_of_scope:${outOfScope.join(",")} ${detail}` };
  }

  // 2. 単一媒体のみのスクープ系は誤報リスクが高い→複数媒体一致まで待つ
  if (input.distinctFeeds < 2 && input.classification !== "official") {
    return { action: "reject", score, reason: `single_source ${detail}` };
  }

  // 3. スコア閾値
  if (score < PUBLISH_THRESHOLD) {
    return { action: "reject", score, reason: `below_threshold ${detail}` };
  }

  // 3b. 一次情報 or 速報LIVE のみ公開（報道だけの日常ネタは見送り）
  const primary = hasPrimarySource(input);
  const breaking = isBreakingNews(input);
  if (!primary && !breaking) {
    return { action: "reject", score, reason: `no_primary_source ${detail}` };
  }

  // 4. 日次上限（コスト暴走・低品質乱発の防止）
  if (input.publishedToday >= input.dailyLimit) {
    return { action: "hold", score, reason: `daily_limit ${detail}` };
  }

  // 5. 公開。公式系はOFFICIAL、速報のみREPORTED（続報LIVE用）
  const confirmation = primary ? "OFFICIAL" : "REPORTED";
  return { action: "publish", confirmation, score, reason: `${primary ? "primary" : "breaking"} ${detail}` };
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
