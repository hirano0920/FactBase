/**
 * FactBase Radar バズ駆動記事の公開（④）— 選定ロジックの純関数部分。
 * promote.ts のオーケストレーションから分離し、DB/外部APIなしでテストできるようにする。
 */
import { evaluateBuzzPromoteSufficiency, type EvidenceBundle } from "./research";
import { isPlausibleFollowUp } from "../../../src/lib/radar";
import {
  debateTypePromoteBonus,
  isPromotableDebateType,
  resolveDebateType,
  type DebateType,
} from "../../../src/lib/debate-type";

export type SavedEvidence = EvidenceBundle & {
  buzzScore?: number;
  buzzSources?: string[];
  voteQuestion?: string;
  voteChoices?: { for: string; against: string; undecided: string };
  /** e-Stat政府統計（EvidenceBundleのestatStatsをSavedEvidenceでも保持） */
  estatStats?: import("../sources/estat").EStatItem[];
  /**
   * detect.ts（RSS経路）で「多数の媒体が報じているが一次情報が無く、まだSNSでバズる前」という理由で
   * 公開見送り（no_primary_source / defer_buzz_pipeline）になった候補を discover.ts が引き取り、
   * 能動調査した結果ここでも強い媒体一致（distinctNewsOutlets≥CONSENSUS_MIN_OUTLETS）が確認できた印。
   * buzzScoreが低くても media consensus 経路で promote 対象にする（バズ前の重要報道の取りこぼし防止）。
   */
  mediaConsensus?: boolean;
  /**
   * 一次情報や対立する言い分を根拠に議論を組み立てられるか（filterRelevantTopicsのdebatable判定）。
   * 声明対立型エンタメ等は「話題だがdebatable」でtrue、単に話題なだけのものはfalse。
   * undefined（法案・引き取り・旧データ）はtrue扱い。
   */
  debatable?: boolean;
  /**
   * TwoSides 争点タイプ（declaration/policy/org_response/norm_flare/indicator/geopolitics）。
   * 本線6型以外・欠落は promote 対象外（旧データは機械推定で救済）。
   */
  debateType?: DebateType | null;
  /** policy のスローバーン再燃（きっかけ先頭＋定番両論） */
  reignite?: boolean;
  /** Google Trends / Yahoo で長時間トレンド継続（discover の sustained） */
  sustained?: boolean;
  /** Yahoo!記事個別ページの総コメント数（賛否分裂の実測・炎上強度の絶対値） */
  commentCount?: number;
  /** 前回調査からcommentCountSurgeThreshold以上増えた＝炎上が加速中 */
  commentCountSurge?: boolean;
};

/** media consensus 経路で公開を許す最低媒体数（通常の証拠十分性2より高く設定し乱発を防ぐ） */
export const CONSENSUS_MIN_OUTLETS = 3;

export interface PromotionCandidate {
  id: string;
  title: string;
  category: string | null;
  topicTerm: string | null;
  sourceUrls: { title: string; url: string; feed: string; publishedAt?: string }[];
  evidence: SavedEvidence;
  /** TopicCandidate.updatedAt。鮮度減衰（古いPENDINGが高スコアのまま居座るのを防ぐ）に使う */
  updatedAt?: Date;
}

/**
 * 鮮度減衰。候補プールは最大36時間（CANDIDATE_FRESHNESS_HOURS）保持されるため、
 * 「調査した瞬間は強かったが今はもう沈静化しているバズ」が古いbuzzScoreのまま
 * 新しい候補を機械的に押しのけないよう、経過時間で緩やかに重みを下げる。
 * 6時間以内は減衰なし、以降36時間にかけて1.0→0.5へ線形減衰（消えはしない）。
 */
const FRESHNESS_FULL_WEIGHT_HOURS = 6;
const FRESHNESS_MIN_WEIGHT_HOURS = 36;
const FRESHNESS_FLOOR = 0.5;

export function freshnessFactor(updatedAt: Date | undefined, now: Date = new Date()): number {
  if (!updatedAt) return 1;
  const ageHours = (now.getTime() - updatedAt.getTime()) / 3_600_000;
  if (ageHours <= FRESHNESS_FULL_WEIGHT_HOURS) return 1;
  if (ageHours >= FRESHNESS_MIN_WEIGHT_HOURS) return FRESHNESS_FLOOR;
  const span = FRESHNESS_MIN_WEIGHT_HOURS - FRESHNESS_FULL_WEIGHT_HOURS;
  const progressed = (ageHours - FRESHNESS_FULL_WEIGHT_HOURS) / span;
  return 1 - progressed * (1 - FRESHNESS_FLOOR);
}

type PromoteScoreInput = Pick<
  PromotionCandidate,
  "title" | "category" | "topicTerm" | "evidence" | "updatedAt"
>;

/**
 * 候補の争点タイプを解決する（evidence.debateType 優先、欠落時は機械推定）。
 * 本線6型以外・推定不能は null → promote 対象外。
 */
export function resolveCandidateDebateType(candidate: PromoteScoreInput): DebateType | null {
  const newsTitles = (candidate.evidence.news ?? []).map((n) => n.title);
  const resolved = resolveDebateType({
    topic: candidate.topicTerm || candidate.evidence.topic || candidate.title,
    category: candidate.category,
    title: candidate.title,
    voteQuestion: candidate.evidence.voteQuestion,
    newsTitles,
    debateType: candidate.evidence.debateType,
    reignite: candidate.evidence.reignite,
  });
  return resolved?.debateType ?? null;
}

/**
 * コメント数（社会炎上量の実測）ボーナス。buzzScoreは「載っているか」の0/1判定止まりだが、
 * こちらは実際のコメント数の絶対値・急増（commentCountSurge）を反映し、
 * 「本当に議論が沸騰しているトピック」を並び順で優先する。
 */
export function commentIntensityBonus(candidate: PromoteScoreInput): number {
  const count = candidate.evidence.commentCount ?? 0;
  let bonus = count >= 3000 ? 1 : count >= 1000 ? 0.5 : 0;
  if (candidate.evidence.commentCountSurge) bonus += 0.5;
  return bonus;
}

/**
 * TwoSides 適合ボーナス（eligible 内の並び順のみ）。
 * debateType 本線ボーナス + 声明対立の媒体厚み。
 */
export function twosidesFitBonus(candidate: PromoteScoreInput, distinctNewsOutlets: number): number {
  if (candidate.evidence.debatable === false) return 0;

  const debateType = resolveCandidateDebateType(candidate);
  if (!debateType) return 0;

  let bonus = debateTypePromoteBonus(debateType);
  if (debateType === "declaration" && distinctNewsOutlets >= 3) bonus += 0.5;
  return bonus;
}

/**
 * promote選定の重み付きスコア（sort key）。debatable=false は減点、
 * debateType 本線ボーナスで声明対立・社会炎上などを上位へ。
 * 選定の可否（eligible）は buzz×証拠×debateType の別判定。ここは並び順のみ。
 * 鮮度減衰（freshnessFactor）はbase側にのみ掛け、debateTypeボーナスは満額のまま
 * （古くても本線debateTypeへの適合自体は変わらないため）。
 */
export function weightedPromoteScore(
  candidate: PromoteScoreInput,
  distinctNewsOutlets: number,
  now: Date = new Date(),
): number {
  const evidence = candidate.evidence;
  const debatableFactor = evidence.debatable === false ? 0.4 : 1.0;
  const outletsFactor = Math.min(1, distinctNewsOutlets / 2);
  const base =
    (evidence.buzzScore ?? 0) * debatableFactor * outletsFactor * freshnessFactor(candidate.updatedAt, now);
  return base + twosidesFitBonus(candidate, distinctNewsOutlets) + commentIntensityBonus(candidate);
}

/**
 * Yahoo!コメントランキング一致（賛否分裂の実測シグナル）が単独ソースの場合の救済最低ライン。
 * 通常のminBuzzScore（4ソースのクロス照合）より低いが、「読まれた」だけでなく
 * 「議論になっている」ことが実測されているため、単一プラットフォームの大バズでも
 * 通常ゲートで機械的に弾かれないようにする。
 */
const COMMENT_RANKING_MIN_BUZZ_SCORE = 1;

function isEligibleForPromotion(
  c: PromotionCandidate,
  suff: ReturnType<typeof evaluateBuzzPromoteSufficiency>,
  minBuzzScore: number,
): boolean {
  if (c.evidence.debatable === false) return false;
  if (!isPromotableDebateType(resolveCandidateDebateType(c))) return false;

  if ((c.evidence.buzzScore ?? 0) >= minBuzzScore && suff.sufficient) return true;
  if (c.evidence.mediaConsensus && suff.distinctNewsOutlets >= CONSENSUS_MIN_OUTLETS) return true;
  if (
    (c.evidence.buzzSources ?? []).includes("yahoo_comment_ranking") &&
    (c.evidence.buzzScore ?? 0) >= COMMENT_RANKING_MIN_BUZZ_SCORE &&
    suff.sufficient
  ) {
    return true;
  }
  return false;
}

/**
 * buzzScore と証拠十分性、かつ本線 debateType を満たす候補だけを残し、
 * 重み付きスコア順で並べる。同一カテゴリ偏りは maxPerCategory で抑える。
 */
export function selectTopicsForPromotion(
  candidates: PromotionCandidate[],
  minBuzzScore: number,
  limit: number,
  maxPerCategory: number = Math.max(1, Math.ceil(limit / 2)),
  now: Date = new Date(),
): PromotionCandidate[] {
  const eligible = candidates
    .map((c) => ({ c, suff: evaluateBuzzPromoteSufficiency(c.evidence) }))
    .filter(({ c, suff }) => isEligibleForPromotion(c, suff, minBuzzScore))
    .sort((a, b) => {
      const scoreDiff =
        weightedPromoteScore(b.c, b.suff.distinctNewsOutlets, now) -
        weightedPromoteScore(a.c, a.suff.distinctNewsOutlets, now);
      if (scoreDiff !== 0) return scoreDiff;
      return b.suff.distinctNewsOutlets - a.suff.distinctNewsOutlets;
    })
    .map(({ c }) => c);

  const selected: PromotionCandidate[] = [];
  const categoryCounts = new Map<string, number>();
  for (const c of eligible) {
    if (selected.length >= limit) break;
    const category = c.category ?? "unknown";
    const count = categoryCounts.get(category) ?? 0;
    if (count >= maxPerCategory) continue;
    selected.push(c);
    categoryCounts.set(category, count + 1);
  }
  if (selected.length < limit) {
    for (const c of eligible) {
      if (selected.length >= limit) break;
      if (selected.includes(c)) continue;
      selected.push(c);
    }
  }
  return selected;
}

export interface ActiveIssueForDedup {
  id: string;
  title: string;
  keywords: string[];
}

/**
 * バズ経路とRSS経路のタイトルゆれを、既存アクティブIssueとの bigram/キーワードで再確認する。
 */
export function findDuplicateActiveIssue(
  candidateTitle: string,
  candidateTopicTerm: string | null,
  activeIssues: ActiveIssueForDedup[],
): ActiveIssueForDedup | null {
  const memberTitles = candidateTopicTerm ? [candidateTopicTerm] : [];
  for (const issue of activeIssues) {
    if (isPlausibleFollowUp(candidateTitle, memberTitles, issue)) return issue;
  }
  return null;
}

function mergeByUrl<T extends { url: string }>(primary: T[] = [], extra: T[] = []): T[] {
  const seen = new Set(primary.map((x) => x.url));
  const merged = [...primary];
  for (const x of extra) {
    if (!seen.has(x.url)) {
      seen.add(x.url);
      merged.push(x);
    }
  }
  return merged;
}

function candidateRichness(c: PromotionCandidate): number {
  return (
    c.sourceUrls.length +
    (c.evidence.news?.length ?? 0) +
    (c.evidence.internationalNews?.length ?? 0) +
    (c.evidence.dietSpeeches?.length ?? 0) +
    (c.evidence.laws?.length ?? 0)
  );
}

/**
 * stronger（証拠の厚い方）を主候補として、weakerの証拠を合流させる。
 * sourceUrls/news等が合流することで、isTimelineWorthy（日付を跨いだ変遷）が
 * 「きっかけとなった出来事→結果」を自動的に時系列セクションとして拾えるようになる
 * （例: 交通違反の発覚→それを理由とした代表辞任、を1本の記事で時系列にまとめる）。
 */
function mergeCandidateInto(stronger: PromotionCandidate, weaker: PromotionCandidate): PromotionCandidate {
  return {
    ...stronger,
    sourceUrls: mergeByUrl(stronger.sourceUrls, weaker.sourceUrls),
    evidence: {
      ...stronger.evidence,
      news: mergeByUrl(stronger.evidence.news, weaker.evidence.news),
      internationalNews: mergeByUrl(stronger.evidence.internationalNews, weaker.evidence.internationalNews),
      dietSpeeches: mergeByUrl(stronger.evidence.dietSpeeches, weaker.evidence.dietSpeeches),
      laws: mergeByUrl(stronger.evidence.laws, weaker.evidence.laws),
      officialEvents: mergeByUrl(stronger.evidence.officialEvents, weaker.evidence.officialEvents),
    },
  };
}

export interface DedupedSelection {
  primary: PromotionCandidate;
  /** 主候補に統合された候補（記事は生成せず、公開後にTopicCandidate.issueIdだけ主候補側に紐づける） */
  absorbed: PromotionCandidate[];
}

/**
 * 同一promoteラン内で選ばれた候補同士に「同一出来事」の重複が無いか、
 * 既存Issueとの重複判定（findDuplicateActiveIssue）と同じisPlausibleFollowUpロジックで確認する。
 * 実例（2026-07-10の実データで発生）: 「山本太郎代表辞任と党運営」と
 * 「山本太郎代表辞任と道路交通法違反」が別トピックとして同時に選ばれ、同じ出来事が
 * 2記事に分裂しかけた。findDuplicateActiveIssueは既存Issueとしか比較しないため、
 * 同一ラン内の候補同士の重複はここで別途拾う。
 */
export function dedupeSelectedCandidates(candidates: PromotionCandidate[]): DedupedSelection[] {
  const groups: DedupedSelection[] = [];
  for (const c of candidates) {
    const group = groups.find((g) =>
      isPlausibleFollowUp(c.title, c.topicTerm ? [c.topicTerm] : [], {
        title: g.primary.title,
        keywords: g.primary.topicTerm ? [g.primary.topicTerm] : [],
      }),
    );
    if (!group) {
      groups.push({ primary: c, absorbed: [] });
      continue;
    }
    if (candidateRichness(c) > candidateRichness(group.primary)) {
      group.absorbed.push(group.primary);
      group.primary = mergeCandidateInto(c, group.primary);
    } else {
      group.absorbed.push(c);
      group.primary = mergeCandidateInto(group.primary, c);
    }
  }
  return groups;
}
