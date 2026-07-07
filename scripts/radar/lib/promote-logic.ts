/**
 * FactBase Radar バズ駆動記事の公開（④）— 選定ロジックの純関数部分。
 * promote.ts のオーケストレーションから分離し、DB/外部APIなしでテストできるようにする。
 */
import { evaluateBuzzPromoteSufficiency, type EvidenceBundle } from "./research";
import { isPlausibleFollowUp } from "../../../src/lib/radar";

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
}

/**
 * buzzScore（Google Trends / Yahoo!リアルタイム / Yahoo!ニュース / YouTube）と
 * 証拠十分性の両方を満たす候補だけを残し、buzzScore→異なる媒体数の順で並べる。
 * どちらか一方だけでは「バズだけで中身がない」「証拠はあるがバズってない」記事に戻るため、
 * AND条件にしている。
 *
 * 選定後は同一カテゴリへの偏りをmaxPerCategoryで抑える。buzzScore純粋順だと、単発の
 * メガバズ争点（例: 一つの経済ニュースが複数の見出しを生む）が同じピーク枠を独占し、
 * 政治・国際・法律等の他カテゴリの良い候補が機械的に押し出されることがあるため
 * （ユーザーが求める「政治・経済・国際関係・戦争・人権等を広く拾う」という要件に反する）。
 * 他カテゴリの候補が無く枠が余る場合は、上限を無視してbuzzScore順に埋め戻す（枠を空けない）。
 */
export function selectTopicsForPromotion(
  candidates: PromotionCandidate[],
  minBuzzScore: number,
  limit: number,
  maxPerCategory: number = Math.max(1, Math.ceil(limit / 2)),
): PromotionCandidate[] {
  const eligible = candidates
    .map((c) => ({ c, suff: evaluateBuzzPromoteSufficiency(c.evidence) }))
    .filter(({ c, suff }) => {
      // 通常経路: バズ強度（4ソースのクロス照合）＋証拠十分性の AND
      if ((c.evidence.buzzScore ?? 0) >= minBuzzScore && suff.sufficient) return true;
      // media consensus 経路: バズ前でも多数の媒体が同一報道なら公開する（detect引き取り分のみ）
      if (c.evidence.mediaConsensus && suff.distinctNewsOutlets >= CONSENSUS_MIN_OUTLETS) return true;
      return false;
    })
    .sort((a, b) => {
      const scoreDiff = (b.c.evidence.buzzScore ?? 0) - (a.c.evidence.buzzScore ?? 0);
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
  // 上限を守ると枠が埋まらない場合（他カテゴリに十分な候補が無い）は、
  // buzzScore順のまま上限を無視して残り枠を埋める（枠を空けたままにしない）
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
 * バズ経路（discover.ts→promote.ts）とRSS経路（detect.ts）は別々のnanoプロンプトが
 * それぞれ独立にタイトルを生成するため、同じ実際の出来事でも言い回しが違い、
 * dedupKeyの文字列一致だけでは重複を防げないことがある。
 * 新規Issue作成前に、既存のアクティブなIssueと出来事として同一と言えるかを
 * bigram類似・キーワード包含（既存のisPlausibleFollowUpと同じロジック）で機械的に再確認し、
 * 同一なら「新規公開」ではなく「既存Issueの続報」として扱えるようにする。
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
