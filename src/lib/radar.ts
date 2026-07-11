/**
 * TwoSides Radar — スコアリングと公開判断の純関数。
 * 公開判断は HotScore × TrustScore − RiskScore。ただし安全ゲートが最優先:
 * ハードブロック該当は点数に関係なく必ずHELD（人間確認必須）。
 */

import { assembleBuzzScore } from "./buzz-cross-match";

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
  /** Google Trends急上昇ワード・Yahoo!リアルタイム検索と一致するか（瞬間的な話題急増シグナル） */
  trending?: boolean;
  /** はてなブックマーク人気エントリ・Yahoo!ニュースランキングと一致するか（読まれている・議論されているシグナル） */
  socialBuzz?: boolean;
  /**
   * 同じ語が何時間も出現し続けている「継続的な話題」か（TrendSightingの定点観測で判定）。
   * trendingが「今バズっているか」の瞬間値なのに対し、こちらは「ずっと話題であり続けているか」を表す。
   */
  sustained?: boolean;
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
  disaster: 5, // 災害はLIVE追跡対象だが、被害規模の誤報リスク分だけ軽く減点
};

/** 政治・経済・法律等の議論スレに載せない話題（1つでも該当→reject） */
export const OUT_OF_SCOPE_FLAGS = [
  "sports_entertainment",
  "celebrity_gossip",
  "pure_weather",
  "pure_science",
] as const;

/** 見出しからスポーツ試合・色恋ゴシップ・科学速報等を機械検出（mini漏れの保険） */
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /ワールドカップ|w杯|world\s*cup|fifa/i,
  /サッカー|soccer|football|プレミア|チャンピオンズリーグ|ucl/i,
  /(試合|ゲーム).{0,8}(結果|終了|勝利|敗北|引き分け)/,
  /\d+\s*[-–—]\s*\d+.*(勝|敗|試合)/,
  /nba|nfl|mlb|nhl|wbc|大谷|本塁打|ホームラン|アシスト|得点王/i,
  /熱愛|結婚(?:を)?(?:発表|へ)|離婚(?:を)?(?:発表|へ)|ゴシップ/i,
  /天気予報|週間天気/,
  /はやぶさ|hayabusa|小惑星|探査機|jaxa|宇宙ステーション|ロケット打ち上げ|天文/i,
];

/** 政策・社会争点など「議論すべき角度」があれば除外パターンでも通す */
const IN_SCOPE_OVERRIDE =
  /予算|法案|政策|国会|省|内閣|外交|安保|入管|規制|補助金|パリ協定|制裁|条約|宇宙基本|ハラスメント|解雇|懲戒|リストラ|炎上|告発|消費者|課金|プライバシー|差別|教育|医療/i;

/**
 * 声明対立型（事務所vs本人・企業vs個人が声明/反論/謝罪を出し合っている）は、
 * 単なる色恋沙汰・慶事とは違い賛否が分かれる社会的議論として除外パターンでも通す。
 * 最終的な「debatableか」の判断は filterRelevantTopics（AI）に委ねる。ここは機械的な足切りの緩和のみ。
 * promote 選定の TwoSides 適合ボーナスでも同じシグナルを使う。
 */
export const DECLARATION_CONFLICT_SIGNAL =
  /声明|反論|抗議|謝罪|否定|見解|コメントを発表|記者会見|訴訟|提訴|契約解除|解雇|懲戒/i;

/** @deprecated 互換 alias — DECLARATION_CONFLICT_SIGNAL を使う */
const DECLARATION_CONFLICT_OVERRIDE = DECLARATION_CONFLICT_SIGNAL;

/**
 * タイトル・トピック語・報道見出しに声明対立の火種シグナルがあるか。
 * TwoSides のお手本（双方声明＋賛否が取れる）を promote 順位で優遇するために使う。
 */
export function looksLikeDeclarationConflict(...texts: (string | null | undefined)[]): boolean {
  const blob = texts.filter(Boolean).join("\n");
  return blob.length > 0 && DECLARATION_CONFLICT_SIGNAL.test(blob);
}

/** 省庁・中央銀行・国会・裁判所など一次情報フィード（feeds.json と同期） */
export const PRIMARY_SOURCE_FEED =
  /^(kantei|cao|digital|boj-|mof|fsa|moj-|mhlw|mlit-|maff|mod-|mofa-|fed-|ecb-|courts|shugiin|sangiin|whitehouse|state-|defense-gov|eu-commission|un-|iaea|who-)/;

/**
 * 🔴 LIVE（REPORTED速報）を許すのは「国家的緊急」のみ。
 * それ以外（X/YouTubeでバズる政治ネタ等）は discover→promote のピーク公開に一本化する。
 */
const LIVE_ELECTION =
  /衆院選|参院選|総選挙|統一地方選|都知事選|都議選|知事選|市長選|選挙(?:の|を)?(?:結果|開票|速報)|開票(?:が|に)?|当選(?:確実|判明)|投票(?:が|の)?終了|出口調査/i;

const LIVE_CABINET =
  /内閣(?:が|の)?(?:成立|発足|総辞職)|新内閣|組閣|総理(?:大臣)?に指名|首相に指名|閣僚人事/i;

const LIVE_WAR =
  /侵攻|開戦|宣戦|全面攻撃|軍事侵攻|空爆|砲撃|ミサイル(?:攻撃|発射)|invasion|airstrike|missile\s*strike/i;

const LIVE_TERROR =
  /テロ(?:リスト|攻撃|発)|(?:連続)?(?:爆発|爆破)|爆弾|自爆|銃撃|発砲|襲撃|暗殺|assassination|terror(?:ist)?\s*attack|mass\s*shooting/i;

/** 大津波警報・津波警報（注意報は含めない＝甚大被害が想定される警報級のみ） */
const LIVE_TSUNAMI =
  /大津波警報|津波警報|巨大津波|tsunami\s*warning|major\s*tsunami/i;

/** 噴火警戒レベル4-5相当・噴火速報・大規模噴火（レベル1-3の平常/注意は含めない） */
const LIVE_ERUPTION =
  /噴火警戒レベル\s*[45]|噴火速報|爆発的噴火|大規模噴火|全島避難|volcan(?:o|ic)\s*eruption|major\s*eruption/i;

/** 原子力災害（原子力緊急事態・炉心溶融・放射性物質の大量放出） */
const LIVE_NUCLEAR =
  /原子力緊急事態|原発事故|炉心溶融|メルトダウン|放射性物質(?:の)?(?:大量)?(?:漏|放出)|nuclear\s*emergency|meltdown/i;

/** 震度6強以上（6弱は含めない＝ユーザー要件どおり6強以上） */
const LIVE_QUAKE_MAG =
  /震度[6-7６-７]強|震度[7７]|震度７|M(?:6\.[5-9]|[7-9]\d*)|マグニチュード(?:6\.[5-9]|[7-9])/i;

/** 甚大な被害の示唆（地震LIVEは震度とセットで要求。震度7/M7+は単独可） */
const LIVE_QUAKE_DAMAGE =
  /甚大(?:な)?被害|死者|死亡(?:が)?確認|全壊|半壊|倒壊|被災者|行方不明|大規模(?:被害|避難)|casualties|killed|deadly|major\s*earthquake/i;

const LIVE_QUAKE_MAG7 = /震度[7７]|震度７|M[7-9]\.|マグニチュード[7-9]/i;

/** 速報として扱う最大経過分（これより古い incident は見送り） */
export const BREAKING_MAX_AGE_MIN = 360;

export function isOutOfScopeTopic(clusterTitle: string, memberTitles: string[]): boolean {
  const blob = [clusterTitle, ...memberTitles].join("\n");
  if (IN_SCOPE_OVERRIDE.test(blob)) return false;
  if (DECLARATION_CONFLICT_OVERRIDE.test(blob)) return false;
  return OUT_OF_SCOPE_PATTERNS.some((p) => p.test(blob));
}

/** 争点化しないルーティンな官公庁更新（日程表・統計掲載等） */
export const ROUTINE_OFFICIAL_PATTERNS: RegExp[] = [
  /開廷期日情報/,
  /最高裁判所開廷期日/,
  /会議日程.*更新/,
  /休廷|休業日.*お知らせ/,
  /統計年報を掲載/,
  /fp:[a-f0-9]{10}\)/,
];

/** 裁判所日程表など、投票・議論の争点にならない一次情報 ping */
export function isRoutineOfficialUpdate(title: string, feedNames: string[] = []): boolean {
  if (feedNames.some((f) => f === "courts-kijitsu")) return true;
  const blob = title.trim();
  if (!blob) return false;
  return ROUTINE_OFFICIAL_PATTERNS.some((p) => p.test(blob));
}

/** フィードに出す前に記事本文が必要か（🔴 LIVE 速報テンプレは例外） */
export function isIssueReadyForPublicFeed(issue: {
  articleHtml: string | null;
  confirmation: "official" | "reported" | null;
}): boolean {
  if (issue.articleHtml) return true;
  return issue.confirmation === "reported";
}

export function isPendingArticlePlaceholder(summary: { lead?: string; bullets?: string[] }): boolean {
  const blob = [summary.lead ?? "", ...(summary.bullets ?? [])].join("\n");
  return /自動生成中|準備中です|詳細まとめを準備/.test(blob);
}

export function hasPrimarySource(input: DecisionInput): boolean {
  if (input.classification === "official" || input.classification === "indicator") return true;
  return (input.feedNames ?? []).some((f) => PRIMARY_SOURCE_FEED.test(f));
}

/**
 * 「元々SNS/Trendsで話題になっている」ことそのものを一次情報の代替根拠とみなす。
 * ユーザー要求（Trendsで既にバズっている話題を選び、情報錯綜を整理する）の核心。
 * 複数媒体一致（distinctFeeds>=2、通常gateで既に要求済み）はここでも維持し、
 * 単一ソースの怪しい話が「バズってる」の一言で素通りしないようにする。
 */
export function isBuzzworthy(input: DecisionInput): boolean {
  return (
    (input.trending === true || input.socialBuzz === true || input.sustained === true) &&
    input.distinctFeeds >= 2
  );
}

/**
 * detect.ts がバズ経路（discover→promote）向けの報道錯綜ネタを先取り公開しないための判定。
 * 公式・LIVE緊急は従来どおり detect が即時処理する。
 */
export function shouldDeferToBuzzPipeline(
  input: DecisionInput,
  decision: PublishDecision,
): boolean {
  if (decision.action !== "publish") return false;
  if (decision.confirmation !== "REPORTED") return false;
  if (hasPrimarySource(input)) return false;
  if (isBreakingNews(input)) return false;
  return true;
}

export function isBreakingNews(input: DecisionInput): boolean {
  if (input.distinctFeeds < 2) return false;
  if (input.minutesSinceLatest > BREAKING_MAX_AGE_MIN) return false;
  const blob = [input.clusterTitle ?? "", ...(input.memberTitles ?? [])].join("\n");

  if (LIVE_ELECTION.test(blob)) return true;
  if (LIVE_CABINET.test(blob)) return true;
  if (LIVE_TERROR.test(blob)) return true;
  if (LIVE_WAR.test(blob)) return true;

  // 大災害（地震以外）: 大津波警報・噴火警戒レベル4-5・原子力緊急事態も国家的緊急としてLIVE対象
  if (LIVE_TSUNAMI.test(blob)) return true;
  if (LIVE_ERUPTION.test(blob)) return true;
  if (LIVE_NUCLEAR.test(blob)) return true;

  if (LIVE_QUAKE_MAG7.test(blob)) return true;
  if (LIVE_QUAKE_MAG.test(blob) && LIVE_QUAKE_DAMAGE.test(blob)) return true;

  return false;
}

/**
 * バズ加点。複数媒体一致・ハードブロックのゲートは一切バイパスしないが、
 * 「一次情報が無い」ことによるrejectだけは isBuzzworthy() 経由でバイパスできる
 * （= 元々SNS/Trendsで話題になっている報道錯綜ネタを拾うための唯一の抜け道）。
 * Trends（検索急増=瞬間風速）を強く、はてブ（読まれ議論されている=継続関心）をやや弱く。
 */
const TRENDING_BONUS = 35;
const SOCIAL_BUZZ_BONUS = 20;
const SUSTAINED_BONUS = 25;

export function hotScore(c: ClusterInput): number {
  const volume = Math.min(c.eventCount * 10, 50);
  const spread = Math.min(c.distinctFeeds * 15, 45); // 複数媒体一致を重視
  const recency =
    c.minutesSinceLatest <= 30 ? 30 : c.minutesSinceLatest <= 120 ? 15 : 0;
  const buzz =
    (c.trending ? TRENDING_BONUS : 0) +
    (c.socialBuzz ? SOCIAL_BUZZ_BONUS : 0) +
    (c.sustained ? SUSTAINED_BONUS : 0);
  return volume + spread + recency + buzz; // 0-180
}

/** クラスタの見出し群がGoogle Trends急上昇ワードのいずれかを含むか判定する */
export function matchesTrending(titles: string[], trendingKeywords: string[]): boolean {
  if (trendingKeywords.length === 0) return false;
  const blob = titles.join(" ");
  return trendingKeywords.some((kw) => blob.includes(kw));
}

/**
 * はてブ人気エントリ等「タイトル同士」の一致判定。
 * 急上昇ワード（短い検索語）と違い記事タイトルは部分文字列一致がほぼ成立しないため、
 * 文字bigramのJaccard類似度で「同じ出来事を指しているか」を判定する。
 */
export { BUZZ_TITLE_SIMILARITY, buzzTitleMatch } from "./buzz-title";

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
  /** 本日すでにRSS経路で公開したREPORTED件数（detect.ts→promote.ts優先のため別枠） */
  publishedReportedToday?: number;
  /** RSS経路REPORTEDの1日上限（未指定なら dailyLimit と同じ） */
  reportedDailyLimit?: number;
  /** クラスタ内フィード名（一次情報判定） */
  feedNames?: string[];
  /** クラスタタイトル（速報キーワード判定） */
  clusterTitle?: string;
  /** クラスタ内の元見出し（nanoが中立化したタイトルで落ちる速報キーワードの補完） */
  memberTitles?: string[];
}

const PUBLISH_THRESHOLD = 45;

export function decidePublish(input: DecisionInput): PublishDecision {
  const hot = hotScore(input);
  const trust = trustScore(input);
  const risk = riskScore(input);
  // 正規化: hot(0-180) × trust(0.2-1.0) − risk
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

  const routineTitle = input.clusterTitle ?? "";
  const routineFeeds = input.feedNames ?? [];
  const routineMembers = input.memberTitles ?? [];
  if (
    isRoutineOfficialUpdate(routineTitle, routineFeeds) ||
    routineMembers.some((t) => isRoutineOfficialUpdate(t, routineFeeds))
  ) {
    return { action: "reject", score, reason: `routine_admin_update ${detail}` };
  }

  // 2. 単一媒体のみのスクープ系は誤報リスクが高い→複数媒体一致まで待つ
  if (input.distinctFeeds < 2 && input.classification !== "official") {
    return { action: "reject", score, reason: `single_source ${detail}` };
  }

  // 3. スコア閾値
  if (score < PUBLISH_THRESHOLD) {
    return { action: "reject", score, reason: `below_threshold ${detail}` };
  }

  // 3b. 一次情報 or LIVE緊急のみ。バズ報道錯綜は promote（ピーク公開）へ譲る
  const primary = hasPrimarySource(input);
  const breaking = isBreakingNews(input);
  const buzzing = isBuzzworthy(input);
  if (!primary && !breaking) {
    if (buzzing) {
      return { action: "reject", score, reason: `defer_buzz_pipeline ${detail}` };
    }
    return { action: "reject", score, reason: `no_primary_source ${detail}` };
  }

  // 4. 日次上限（コスト暴走・低品質乱発の防止）
  if (input.publishedToday >= input.dailyLimit) {
    return { action: "hold", score, reason: `daily_limit ${detail}` };
  }

  // 4b. RSS経路REPORTED（LIVE緊急含む）の別枠上限
  if (!primary) {
    const reportedLimit = input.reportedDailyLimit ?? input.dailyLimit;
    const reportedToday = input.publishedReportedToday ?? 0;
    if (reportedToday >= reportedLimit) {
      return { action: "hold", score, reason: `reported_daily_limit ${detail}` };
    }
  }

  // 5. 公開。公式系はOFFICIAL、LIVE緊急のみREPORTED
  const confirmation = primary ? "OFFICIAL" : "REPORTED";
  const via = primary ? "primary" : "breaking";
  return { action: "publish", confirmation, score, reason: `${via} ${detail}` };
}

/**
 * JSTの当日0:00を表すインスタンス。
 * `new Date(new Date().toISOString().slice(0,10))` はUTC0:00＝JST9:00で日付が変わるため、
 * 「本日の公開件数」等の日次集計がJSTの朝9時にリセットされてしまう。日次上限はJST基準で数える。
 */
export function jstDayStart(now: Date = new Date()): Date {
  const jst = new Date(now.getTime() + 9 * 3_600_000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 3_600_000);
}

/** slug用のJST日付文字列（YYYY-MM-DD）。UTC日付だと深夜JSTの記事が前日slugになる */
export function jstDateString(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
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

/**
 * nanoの続報マッチ（match_issue_id）の機械裏取り。
 * 新規クラスタにはclusterCoherenceの裏取りがあるのに続報マッチは無条件で信用していたため、
 * 誤マッチで無関係な出来事が既存Issueのタイムラインを汚すリスクがあった。
 * Issueタイトルは「〜をどう見る？」形式に中立化されており見出しと語彙が離れがちなので、
 * キーワード包含（強いシグナル）を優先し、bigram類似はゆるい下限として使う。
 */
export const FOLLOW_UP_MATCH_SIMILARITY = 0.08;

export function isPlausibleFollowUp(
  clusterTitle: string,
  memberTitles: string[],
  issue: { title: string; keywords: string[] },
): boolean {
  const blob = [clusterTitle, ...memberTitles].join("\n");
  // 1. Issueのキーワード（元クラスタ題・法案名）が見出し群に含まれていれば続報とみなす
  if (issue.keywords.some((kw) => kw.length >= 2 && blob.includes(kw))) return true;
  // 2. それ以外はタイトル同士のbigram類似で最低限の関連を要求する
  const issueSet = bigrams(`${issue.title} ${issue.keywords.join(" ")}`);
  return [clusterTitle, ...memberTitles].some(
    (t) => jaccard(bigrams(t), issueSet) >= FOLLOW_UP_MATCH_SIMILARITY,
  );
}

/**
 * 議案フィード（shugiin-gian/sangiin-gian）のタイトルから法案名を取り出す。
 * 例: 「衆議院第218回: 「国旗損壊罪を新設する刑法改正案」→ 委員会審査中」→「国旗損壊罪を新設する刑法改正案」
 * 法案の審議状況変化はnanoを介さず、この法案名でIssue.keywordsと直接照合して
 * タイムラインに追記する（審議進捗の確実なトラッキング）。
 */
export function extractBillTitle(feedTitle: string): string | null {
  const m = feedTitle.match(/「(.+?)」/);
  const title = m?.[1]?.trim() ?? "";
  return title.length >= 4 ? title : null;
}

export interface FollowUpAggregate {
  confirmation: "OFFICIAL" | "REPORTED" | "MANUAL";
  articleGeneratedAt: Date;
  newEventCount: number;
  newDistinctFeeds: number;
  maxNewTrustWeight: number;
}

/** 続報再生成の最短間隔（分）。confirmationにより速報LIVEを優先して短くする */
export const FOLLOW_UP_MIN_INTERVAL_MIN = {
  REPORTED: 30,
  OFFICIAL: 120,
} as const;

/** 一次情報とみなす信頼度の下限（PRIMARY_SOURCE_FEEDと同水準） */
const FOLLOW_UP_PRIMARY_TRUST_THRESHOLD = 85;

/**
 * 続報を反映して記事を再生成すべきか判定する純関数。
 * LIVE(REPORTED)は新着distinctFeed>=1で30分間隔、OFFICIALは新着に一次情報級の
 * trustWeightがあり2時間間隔、を最短サイクルとする（静かなOFFICIAL案件でAI予算を消費しすぎない）。
 */
export function shouldRegenerateFollowUp(agg: FollowUpAggregate, now: Date): boolean {
  if (agg.newEventCount <= 0) return false;
  const minutesSinceGenerated = (now.getTime() - agg.articleGeneratedAt.getTime()) / 60_000;

  if (agg.confirmation === "REPORTED") {
    return agg.newDistinctFeeds >= 1 && minutesSinceGenerated >= FOLLOW_UP_MIN_INTERVAL_MIN.REPORTED;
  }
  if (agg.confirmation === "OFFICIAL") {
    return (
      agg.maxNewTrustWeight >= FOLLOW_UP_PRIMARY_TRUST_THRESHOLD &&
      minutesSinceGenerated >= FOLLOW_UP_MIN_INTERVAL_MIN.OFFICIAL
    );
  }
  return false;
}

/**
 * バズ駆動パイプライン（discover.ts/promote.ts）専用のバズ強度スコア。
 * 「Google Trends・Yahoo!リアルタイム・Yahooニュースランキング・YouTubeトレンドの
 * 何個に載っているか」のクロス照合＝本物のバズかどうかの主判定にする（片方だけは弱いシグナル）。
 * 検索語系（Trends/Yahooリアルタイム）は短い語なので部分一致、
 * ニュース見出し系はbigram類似（buzzTitleMatch）で判定する。
 */
export interface BuzzSourceHit {
  inGoogleTrends: boolean;
  inYahooRealtime: boolean;
  inNewsRanking: boolean;
  inYouTubeTrending: boolean;
  /** ニュースランキング内で同一争点見出しが閾値以上（速報クラスタ） */
  inNewsCluster: boolean;
  /** Yahoo!コメントランキング内＝「賛否が割れて議論になっている」の実測シグナル */
  inCommentRanking: boolean;
  /** 4ソースの素点 0-4 */
  score: number;
  /** promote/深掘り優先用。score + Newsクラスタ + コメントランキングボーナス（上限5） */
  effectiveScore: number;
  /** クラスタに含まれる見出し数（ログ用） */
  newsClusterCount: number;
}

export interface BuzzSourceInputs {
  googleTerms: string[];
  yahooRealtimeTerms: string[];
  newsRankingTitles: string[];
  youtubeTrendingTitles: string[];
  /** Yahoo!コメントランキング見出し。省略時は未計測（false扱い） */
  commentRankingTitles?: string[];
}

export function computeBuzzScore(topic: string, sources: BuzzSourceInputs): BuzzSourceHit {
  return assembleBuzzScore(topic, sources);
}

/** evidenceJson.buzzSources 用ラベル */
export function buzzSourceLabels(hit: BuzzSourceHit): string[] {
  return [
    hit.inGoogleTrends && "google_trends",
    hit.inYahooRealtime && "yahoo_realtime",
    hit.inNewsRanking && "yahoo_news_ranking",
    hit.inYouTubeTrending && "youtube_trending",
    hit.inNewsCluster && "news_cluster",
    hit.inCommentRanking && "yahoo_comment_ranking",
  ].filter((s): s is string => Boolean(s));
}

/** promote・深掘り優先で使うスコア */
export function buzzEffectiveScore(hit: BuzzSourceHit): number {
  return hit.effectiveScore;
}

type IssueCategoryId =
  | "POLITICS"
  | "LAW"
  | "ECONOMY"
  | "FINANCE"
  | "EDUCATION"
  | "SOCIETY"
  | "ENTERTAINMENT";

/** discover.ts/promote.tsのnano分類カテゴリ → IssueCategory（detect.tsのtoIssueCategoryと同じ対応） */
export function toIssueCategory(category: string): IssueCategoryId {
  const map: Record<string, IssueCategoryId> = {
    politics: "POLITICS",
    economy: "ECONOMY",
    law: "LAW",
    finance: "FINANCE",
    education: "EDUCATION",
    society: "SOCIETY",
    entertainment: "ENTERTAINMENT",
    rights: "POLITICS",
    international: "POLITICS",
  };
  return map[category] ?? "POLITICS";
}

/**
 * 海外報道を記事材料に使うか。
 * 国内主（社会炎上・国内政治・国内経済など）は国内メディアのみ。
 * 海外が主戦場（戦争・外交・米中など）のときだけ海外抜粋を渡す。
 */
const INTERNATIONAL_PRIMARY_TOPIC =
  /戦争|停戦|侵攻|開戦|NATO|ウクライナ|ロシア|台湾有事|中東|ガザ|イスラエル|イラン|米中|対中関税|関税戦争|北朝鮮.*ミサイル|安保理/i;

export function shouldUseInternationalReports(
  category: string | null | undefined,
  topic: string,
): boolean {
  if ((category ?? "").toLowerCase() === "international") return true;
  return INTERNATIONAL_PRIMARY_TOPIC.test(topic);
}
