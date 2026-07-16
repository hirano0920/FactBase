/**
 * Radar トピック選定パイプラインの可視化・監査用ロジック。
 * scripts/radar/inspect-pipeline.ts と /admin/radar-pipeline から共有する。
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { RADAR } from "@/lib/constants";
import {
  computeBuzzScore,
  buzzSourceLabels,
  buzzEffectiveScore,
  type BuzzSourceInputs,
} from "@/lib/radar";
import {
  evaluateEvidenceSufficiency,
  evaluateBuzzPromoteSufficiency,
  type EvidenceBundle,
} from "../../scripts/radar/lib/research";
import {
  selectTopicsForPromotion,
  type PromotionCandidate,
  type SavedEvidence,
} from "../../scripts/radar/lib/promote-logic";

/**
 * discover→promote（buzz_promote）が主力経路。rss_detect/summarizeはLIVE速報（🔴国家的緊急のみ）と
 * 官公庁一次情報の例外経路で、バズ駆動の記事化はしない（detect.ts参照）。両経路は並走する設計で、
 * rss_detect/summarizeを「格下げ」する予定はない（LIVE速報の安全網として恒久的に必要）。
 */
export type IssueRoute =
  | "buzz_promote"
  | "rss_detect"
  | "summarize"
  | "followup"
  | "manual"
  | "unknown";

export type PromotionSkipReason =
  | "would_publish"
  | "not_buzz_source"
  | "wrong_status"
  | "already_linked"
  | "stale"
  | "buzz_score_low"
  | "evidence_insufficient"
  | "ranked_out";

const SOURCE_LABELS: Record<string, string> = {
  google_trends: "Google Trends",
  yahoo_realtime: "Yahoo!リアルタイム",
  yahoo_news_ranking: "Yahoo!ニュースランキング",
  youtube_trending: "YouTube",
};

const CANDIDATE_FRESHNESS_HOURS = 36;

export function inferIssueRoute(slug: string, discoverySource: string | null): IssueRoute {
  if (slug.startsWith("radar-buzz-")) return "buzz_promote";
  if (slug.startsWith("radar-")) return "rss_detect";
  if (discoverySource === "buzz") return "buzz_promote";
  if (discoverySource === "bill" || discoverySource === "rss") return "rss_detect";
  return "unknown";
}

export function routeLabel(route: IssueRoute): string {
  switch (route) {
    case "buzz_promote":
      return "④ バズ経路（discover→promote）";
    case "rss_detect":
      return "② RSS経路（detect.ts）";
    case "summarize":
      return "⑤ summarize（既存争点の記事化）";
    case "followup":
      return "続報（followup.ts）";
    case "manual":
      return "手動";
    default:
      return "不明";
  }
}

export function formatBuzzSources(sources: string[] | undefined): string {
  if (!sources?.length) return "—";
  return sources.map((s) => SOURCE_LABELS[s] ?? s).join(" + ");
}

export interface PromotionEvaluation {
  id: string;
  title: string;
  topicTerm: string | null;
  status: string;
  discoverySource: string | null;
  buzzScore: number;
  buzzSources: string[];
  distinctNewsOutlets: number;
  bonusSignals: string[];
  sufficient: boolean;
  skipReason: PromotionSkipReason;
  skipDetail: string;
  updatedAt: string;
  wouldSelect: boolean;
  rankAmongEligible: number | null;
}

export function evaluatePromotionCandidate(
  row: {
    id: string;
    title: string;
    topicTerm: string | null;
    status: string;
    discoverySource: string | null;
    issueId: string | null;
    updatedAt: Date;
    evidenceJson: unknown;
  },
  opts: {
    minBuzzScore: number;
    freshSince: Date;
    selectedIds: Set<string>;
    eligibleRank: Map<string, number>;
  },
): PromotionEvaluation {
  const raw = (row.evidenceJson ?? {}) as Partial<SavedEvidence>;
  const evidence: SavedEvidence = {
    topic: raw.topic ?? row.topicTerm ?? row.title,
    dietSpeeches: raw.dietSpeeches ?? [],
    laws: raw.laws ?? [],
    news: raw.news ?? [],
    internationalNews: raw.internationalNews ?? [],
    background: raw.background ?? null,
    officialEvents: raw.officialEvents ?? [],
    gatheredAt: raw.gatheredAt ?? "",
    buzzScore: raw.buzzScore,
    buzzSources: raw.buzzSources,
    voteQuestion: raw.voteQuestion,
    voteChoices: raw.voteChoices,
  };
  const buzzScore = evidence.buzzScore ?? 0;
  const buzzSources = evidence.buzzSources ?? [];
  const suff = evaluateEvidenceSufficiency(evidence);

  let skipReason: PromotionSkipReason = "would_publish";
  let skipDetail = "次の promote 実行で記事化対象";

  if (row.discoverySource !== "buzz") {
    skipReason = "not_buzz_source";
    skipDetail = `discoverySource=${row.discoverySource ?? "null"}（promote は buzz のみ）`;
  } else if (row.status !== "PENDING") {
    skipReason = "wrong_status";
    skipDetail = `status=${row.status}`;
  } else if (row.issueId) {
    skipReason = "already_linked";
    skipDetail = "既に Issue に紐付き済み";
  } else if (row.updatedAt < opts.freshSince) {
    skipReason = "stale";
    skipDetail = `${CANDIDATE_FRESHNESS_HOURS}時間より古い（updatedAt=${row.updatedAt.toISOString()}）`;
  } else if (buzzScore < opts.minBuzzScore) {
    skipReason = "buzz_score_low";
    skipDetail = `buzzScore=${buzzScore} < 閾値${opts.minBuzzScore}`;
  } else if (!suff.sufficient) {
    skipReason = "evidence_insufficient";
    skipDetail = `異なる媒体${suff.distinctNewsOutlets}件・加点${suff.bonusSignals.join(",") || "なし"}`;
  } else if (!opts.selectedIds.has(row.id)) {
    skipReason = "ranked_out";
    const rank = opts.eligibleRank.get(row.id);
    skipDetail = `条件は満たすが上位${RADAR.buzzArticlesPerWindow}件外${rank != null ? `（eligible内${rank}位）` : ""}`;
  }

  return {
    id: row.id,
    title: row.title,
    topicTerm: row.topicTerm,
    status: row.status,
    discoverySource: row.discoverySource,
    buzzScore,
    buzzSources,
    distinctNewsOutlets: suff.distinctNewsOutlets,
    bonusSignals: suff.bonusSignals,
    sufficient: suff.sufficient,
    skipReason,
    skipDetail,
    updatedAt: row.updatedAt.toISOString(),
    wouldSelect: skipReason === "would_publish",
    rankAmongEligible: opts.eligibleRank.get(row.id) ?? null,
  };
}

export interface LiveBuzzPreview {
  googleTrends: string[];
  yahooRealtime: string[];
  yahooNewsRanking: string[];
  youtubeTrending: string[];
  /** 収集語に対する buzzScore プレビュー（nano フィルタ前） */
  termPreviews: Array<{
    term: string;
    buzzScore: number;
    buzzSources: string[];
  }>;
}

export interface PipelineInspectReport {
  generatedAt: string;
  thresholds: {
    minBuzzScoreForPromotion: number;
    buzzArticlesPerWindow: number;
    researchTopicsPerRun: number;
    topicFilterMaxTerms: number;
    discoverResearchOutsideWindow: number;
    liveEmergencyAutoPublishPerDay: number;
    rssReportedAutoPublishPerDay: number;
    deferReportedBuzzToPromote: boolean;
    candidateFreshnessHours: number;
    discoverWindowsJst: typeof RADAR.discoverWindowsJst;
    peakWindowsJst: typeof RADAR.peakWindowsJst;
  };
  liveBuzz: LiveBuzzPreview | null;
  promotionSimulation: {
    pendingBuzzCount: number;
    selected: PromotionEvaluation[];
    rejected: PromotionEvaluation[];
  };
  recentCandidates: PromotionEvaluation[];
  recentIssues: Array<{
    slug: string;
    title: string;
    confirmation: string;
    createdAt: string;
    route: IssueRoute;
    routeLabel: string;
    discoverySource: string | null;
    buzzScore: number | null;
    buzzSources: string[];
    timelineHint: string | null;
  }>;
}

async function fetchLiveBuzzPreview(): Promise<LiveBuzzPreview> {
  const { fetchTrendingKeywords } = await import("../../scripts/radar/sources/trends");
  const { fetchYahooRealtimeBuzz } = await import("../../scripts/radar/sources/yahoo-realtime");
  const { fetchYahooNewsRankingTitles } = await import("../../scripts/radar/sources/yahoo-news-ranking");
  const { fetchYouTubeTrendingTitles } = await import("../../scripts/radar/sources/youtube-trending");

  const [googleTrends, yahooBuzz, yahooNewsRanking] = await Promise.all([
    fetchTrendingKeywords(),
    fetchYahooRealtimeBuzz(),
    fetchYahooNewsRankingTitles(),
  ]);
  const youtubeTrending = await fetchYouTubeTrendingTitles(yahooNewsRanking);

  const yahooRealtime = yahooBuzz.map((b) => b.term);
  const inputs: BuzzSourceInputs = {
    googleTerms: googleTrends,
    yahooRealtimeTerms: yahooRealtime,
    newsRankingTitles: yahooNewsRanking,
    // 横断スコアは自己参照（ニュース見出しシード検索）を避けるためorganicのみを使う
    youtubeTrendingTitles: youtubeTrending.organic.map((e) => e.title),
  };

  const youtubeTitles = youtubeTrending.all.map((e) => e.title);
  const allTerms = Array.from(
    new Set([...googleTrends, ...yahooRealtime, ...yahooNewsRanking, ...youtubeTitles]),
  );

  const termPreviews = allTerms
    .map((term) => {
      const hit = computeBuzzScore(term, inputs);
      return {
        term,
        buzzScore: buzzEffectiveScore(hit),
        buzzSources: buzzSourceLabels(hit),
      };
    })
    .sort((a, b) => b.buzzScore - a.buzzScore || a.term.localeCompare(b.term, "ja"));

  return {
    googleTrends,
    yahooRealtime,
    yahooNewsRanking,
    youtubeTrending: youtubeTitles,
    termPreviews,
  };
}

export async function buildPipelineInspectReport(
  prisma: PrismaClient,
  opts: { includeLiveBuzz?: boolean } = {},
): Promise<PipelineInspectReport> {
  const freshSince = new Date(Date.now() - CANDIDATE_FRESHNESS_HOURS * 60 * 60_000);
  const minBuzz = RADAR.minBuzzScoreForPromotion;

  const [pendingRows, recentCandidateRows, recentIssues] = await Promise.all([
    prisma.topicCandidate.findMany({
      where: {
        discoverySource: "buzz",
        status: "PENDING",
        issueId: null,
        evidenceJson: { not: Prisma.JsonNull },
        updatedAt: { gte: freshSince },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.topicCandidate.findMany({
      where: { discoverySource: { in: ["buzz", "bill"] } },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.issue.findMany({
      where: { confirmation: { not: "MANUAL" }, slug: { startsWith: "radar" } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        slug: true,
        title: true,
        confirmation: true,
        createdAt: true,
        timeline: {
          orderBy: { at: "asc" },
          take: 1,
          select: { label: true },
        },
      },
    }),
  ]);

  const candidateByIssueId = new Map(
    (
      await prisma.topicCandidate.findMany({
        where: { issueId: { in: recentIssues.map((i) => i.id) } },
        select: { issueId: true, discoverySource: true, evidenceJson: true },
      })
    )
      .filter((c): c is typeof c & { issueId: string } => c.issueId != null)
      .map((c) => [c.issueId, c] as const),
  );

  const promotionCandidates: PromotionCandidate[] = pendingRows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    topicTerm: r.topicTerm,
    sourceUrls: (r.sourceUrls as unknown as { title: string; url: string; feed: string }[]) ?? [],
    evidence: r.evidenceJson as unknown as SavedEvidence,
  }));

  const selectedRows = selectTopicsForPromotion(
    promotionCandidates,
    minBuzz,
    RADAR.buzzArticlesPerWindow,
  );
  const selectedIds = new Set(selectedRows.map((c) => c.id));

  const eligibleSorted = promotionCandidates
    .map((c) => ({ c, suff: evaluateBuzzPromoteSufficiency(c.evidence as EvidenceBundle) }))
    .filter(
      ({ c, suff }) =>
        (c.evidence.buzzScore ?? 0) >= minBuzz && suff.sufficient,
    )
    .sort((a, b) => {
      const scoreDiff = (b.c.evidence.buzzScore ?? 0) - (a.c.evidence.buzzScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return b.suff.distinctNewsOutlets - a.suff.distinctNewsOutlets;
    });

  const eligibleRank = new Map(eligibleSorted.map(({ c }, i) => [c.id, i + 1]));

  const evalOpts = { minBuzzScore: minBuzz, freshSince, selectedIds, eligibleRank };

  const promotionEvals = pendingRows.map((r) => evaluatePromotionCandidate(r, evalOpts));
  const selected = promotionEvals.filter((e) => e.wouldSelect);
  const rejected = promotionEvals.filter((e) => !e.wouldSelect);

  const recentCandidates = recentCandidateRows.map((r) =>
    evaluatePromotionCandidate(r, evalOpts),
  );

  const liveBuzz = opts.includeLiveBuzz ? await fetchLiveBuzzPreview() : null;

  return {
    generatedAt: new Date().toISOString(),
    thresholds: {
      minBuzzScoreForPromotion: minBuzz,
      buzzArticlesPerWindow: RADAR.buzzArticlesPerWindow,
      researchTopicsPerRun: RADAR.researchTopicsPerRun,
      topicFilterMaxTerms: RADAR.topicFilterMaxTerms,
      discoverResearchOutsideWindow: RADAR.discoverResearchOutsideWindow,
      liveEmergencyAutoPublishPerDay: RADAR.liveEmergencyAutoPublishPerDay,
      rssReportedAutoPublishPerDay: RADAR.rssReportedAutoPublishPerDay,
      deferReportedBuzzToPromote: RADAR.deferReportedBuzzToPromote,
      candidateFreshnessHours: CANDIDATE_FRESHNESS_HOURS,
      discoverWindowsJst: RADAR.discoverWindowsJst,
      peakWindowsJst: RADAR.peakWindowsJst,
    },
    liveBuzz,
    promotionSimulation: {
      pendingBuzzCount: pendingRows.length,
      selected,
      rejected,
    },
    recentCandidates,
    recentIssues: recentIssues.map((issue) => {
      const linked = candidateByIssueId.get(issue.id);
      const ds = linked?.discoverySource ?? null;
      const evidence = linked?.evidenceJson as SavedEvidence | null;
      const route = inferIssueRoute(issue.slug, ds);
      return {
        slug: issue.slug,
        title: issue.title,
        confirmation: issue.confirmation,
        createdAt: issue.createdAt.toISOString(),
        route,
        routeLabel: routeLabel(route),
        discoverySource: ds,
        buzzScore: evidence?.buzzScore ?? null,
        buzzSources: evidence?.buzzSources ?? [],
        timelineHint: issue.timeline[0]?.label ?? null,
      };
    }),
  };
}
