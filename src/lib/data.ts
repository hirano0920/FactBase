/**
 * データアクセス層。
 * DATABASE_URL があれば Prisma、なければ mock-data にフォールバック。
 * （フォールバックはNeon接続前のローカル開発・ビルド用）
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  MOCK_ISSUES,
  getCommentsByIssueId as mockComments,
  getIssueBySlug as mockIssueBySlug,
  getRanking as mockRanking,
} from "@/lib/mock-data";
import { enumToChoice } from "@/lib/votes";
import {
  CATEGORIES,
  BURST,
  DEBATE_HIGHLIGHT_MIN_COMMENTS,
  HOME_FEED_PAGE_SIZE,
  MODERATION,
  REPLY_LIMITS,
  type CategoryId,
  type CommentSortId,
  type IssueSortId,
  type IssueStatus,
} from "@/lib/constants";
import { getUserPublicStatsBatch } from "@/lib/user-stats";
import { isIssueReadyForPublicFeed, isPendingArticlePlaceholder } from "@/lib/radar";
import { parseDebateType } from "@/lib/debate-type";
import { sortByBridgingScore } from "@/lib/bridging";
import { qualifiesVerifiedBadge } from "@/lib/fc-display";
import { generateSteelman } from "@/lib/ai";
import { extractOpeningSummary } from "@/lib/article-sections";
import { enrichSummaryForDisplay } from "@/lib/article-quality";
import {
  filterIssues,
  paginateIssues,
  sortIssuesList,
} from "@/lib/issues-feed-utils";
import { getCachedIssue, setCachedIssue } from "@/lib/issue-cache";
import {
  commentsCacheKey,
  commentsVerKey,
  debateHighlightsCacheKey,
  getCacheVersion,
  issuesListCacheKey,
  kv,
  rankingCacheKey,
  rankingBySortCacheKey,
  rankingWeeklyCacheKey,
  splitCommentsCacheKey,
  timelineCacheKey,
  timelineVerKey,
} from "@/lib/redis";
import type {
  Issue as DbIssue,
  Comment as DbComment,
  User as DbUser,
  FcCache as DbFcCache,
  IssueCategory,
  IssueStatus as DbIssueStatus,
  VoteChoice,
} from "@prisma/client";
import type {
  Comment,
  FcVerdictId,
  Issue,
  IssueSummary,
  RankingItem,
  SplitComment,
  VoteTally,
} from "@/types";

export const isDbEnabled = () => Boolean(process.env.DATABASE_URL);

/** Upstash が遅い/死んでいるとき DB 直行（最大 1.5 秒待つ） */
async function kvGetFast(key: string): Promise<string | null> {
  try {
    return await Promise.race([
      kv.get(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
  } catch {
    return null;
  }
}

function kvSetBackground(key: string, value: string, ex: number): void {
  void kv.set(key, value, { ex }).catch(() => {});
}

function issueCreatedAt(issue: DbIssue): Date {
  const raw = issue.createdAt;
  return raw instanceof Date ? raw : new Date(String(raw));
}

const categoryToId: Record<IssueCategory, CategoryId> = {
  POLITICS: "politics",
  LAW: "law",
  ECONOMY: "economy",
  FINANCE: "finance",
  EDUCATION: "education",
  SOCIETY: "society",
  ENTERTAINMENT: "entertainment",
};

const statusToId: Record<DbIssueStatus, IssueStatus> = {
  ACTIVE: "active",
  TRENDING: "trending",
  PASSED: "passed",
  ARCHIVED: "archived",
};

function tallyFromCounters(issue: DbIssue): VoteTally {
  const counts = {
    for: issue.voteForCount,
    against: issue.voteAgainstCount,
    undecided: issue.voteUndecidedCount,
  };
  const total = counts.for + counts.against + counts.undecided;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  return {
    ...counts,
    totalVotes: total,
    totalVoters: total,
    percents: {
      for: pct(counts.for),
      against: pct(counts.against),
      undecided: pct(counts.undecided),
    },
  };
}

function mapIssue(issue: DbIssue): Issue {
  const rawSummary = issue.summaryJson as unknown as IssueSummary;
  const withLead: IssueSummary = {
    ...rawSummary,
    lead: extractOpeningSummary(issue.articleHtml, rawSummary.lead ?? ""),
    bullets: rawSummary.bullets ?? [],
    sources: rawSummary.sources ?? [],
  };
  const summary = enrichSummaryForDisplay(withLead, issue.articleHtml) as IssueSummary;
  return {
    id: issue.id,
    slug: issue.slug,
    title: issue.title,
    shareTitle: issue.shareTitle,
    category: categoryToId[issue.category],
    status: statusToId[issue.status],
    summary,
    articleHtml: issue.articleHtml,
    articleGeneratedAt: issue.articleGeneratedAt?.toISOString() ?? null,
    monitoringUntil: issue.monitoringUntil?.toISOString() ?? null,
    voteTally: tallyFromCounters(issue),
    commentCount: issue.commentCount,
    createdAt: issue.createdAt.toISOString(),
    confirmation:
      issue.confirmation === "OFFICIAL"
        ? "official"
        : issue.confirmation === "REPORTED"
          ? "reported"
          : null,
    voteLabels: (issue.voteLabelsJson as Issue["voteLabels"]) ?? null,
    debateType: parseDebateType(issue.debateType),
    underReview: issue.underReview,
    thumbnailUrl: issue.thumbnailUrl,
    thumbnailSourceUrl: issue.thumbnailSourceUrl,
    thumbnailSourceFeed: issue.thumbnailSourceFeed,
  };
}

type DbCommentWithUser = DbComment & {
  user: Pick<DbUser, "id" | "name" | "plan">;
  fcCache: DbFcCache | null;
  issue: { category: IssueCategory };
  replies?: DbCommentWithUser[];
};

type UserStatsMap = Map<string, { visibleCommentCount: number; totalLikes: number }>;

function mapComment(comment: DbCommentWithUser, statsMap: UserStatsMap): Comment {
  const stats = statsMap.get(comment.userId) ?? { visibleCommentCount: 0, totalLikes: 0 };
  return {
    id: comment.id,
    issueId: comment.issueId,
    userId: comment.userId,
    userName: comment.user.name ?? "名無しの議論者",
    userPlan: comment.user.plan,
    userCommentCount: stats.visibleCommentCount,
    userTotalLikes: stats.totalLikes,
    stance: enumToChoice[comment.stance],
    body: comment.body,
    likeCount: comment.likeCount,
    dislikeCount: comment.dislikeCount,
    helpfulCount: comment.helpfulCount,
    // Plus/Pro + verdict=TRUE のとき ✅（出典で確認）。Grok oracle ではなく「検証を通した主張」の社会的証明
    verifiedBadge: qualifiesVerifiedBadge(comment.fcCache?.verdict ?? null, comment.user.plan),
    fcResult: comment.fcCache
      ? {
          verdict: comment.fcCache.verdict.toLowerCase() as FcVerdictId,
          label: comment.fcCache.label,
          reason: comment.fcCache.reason,
          sources: Array.isArray(comment.fcCache.sourceUrls)
            ? (comment.fcCache.sourceUrls as { label: string; url: string }[])
            : [],
          checkedAt: comment.fcCache.createdAt.toISOString(),
        }
      : null,
    createdAt: comment.createdAt.toISOString(),
    parentId: comment.parentId,
    replyCount: comment.replyCount,
    // 返信自身の返信は仕様上存在しないため、ここでは常に空配列にする（1階層のみ）
    replies: (comment.replies ?? []).map((r) => mapComment(r, statsMap)),
  };
}

export interface RelatedIssueBrief {
  slug: string;
  title: string;
  category: CategoryId;
}

/** keywordsが重なる過去争点を最大5件返す（記事ページ「関連する争点」欄用） */
export async function getRelatedIssues(slug: string): Promise<RelatedIssueBrief[]> {
  if (!isDbEnabled()) return [];
  const current = await prisma.issue.findUnique({
    where: { slug },
    select: { id: true, keywords: true, title: true },
  });
  if (!current) return [];
  const searchTerms = current.keywords.length > 0 ? current.keywords.slice(0, 3) : [];
  if (searchTerms.length === 0) return [];
  const rows = await prisma.issue.findMany({
    where: {
      id: { not: current.id },
      status: { not: "ARCHIVED" },
      underReview: false,
      OR: searchTerms.map((k) => ({ keywords: { has: k } })),
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { slug: true, title: true, category: true },
  });
  return rows.map((r) => ({ slug: r.slug, title: r.title, category: categoryToId[r.category] }));
}

export interface IssueSearchResult {
  slug: string;
  title: string;
  category: CategoryId;
  commentCount: number;
}

/** 左カラムの記事検索用。タイトル部分一致（大文字小文字を区別しない）で最大N件。 */
export async function searchIssues(query: string, limit = 8): Promise<IssueSearchResult[]> {
  const q = query.trim();
  if (!isDbEnabled() || q.length === 0) return [];
  const rows = await prisma.issue.findMany({
    where: {
      status: { not: "ARCHIVED" },
      underReview: false,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { shareTitle: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { slug: true, title: true, category: true, commentCount: true },
  });
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    category: categoryToId[r.category],
    commentCount: r.commentCount,
  }));
}

export async function getIssueBySlug(slug: string): Promise<Issue | null> {
  if (!isDbEnabled()) return mockIssueBySlug(slug) ?? null;

  const cached = await getCachedIssue(slug);
  if (cached) return cached;

  const issue = await prisma.issue.findUnique({ where: { slug } });
  if (!issue) return null;
  const mapped = mapIssue(issue);
  await setCachedIssue(slug, mapped);
  return mapped;
}

function issueBrief(issue: DbIssue) {
  return {
    id: issue.id,
    slug: issue.slug,
    title: issue.title,
    shareTitle: issue.shareTitle,
    category: categoryToId[issue.category],
    status: statusToId[issue.status],
  };
}

/** ランキング系で共通。同一リクエスト内の findMany 重複を防ぐ。 */
const loadActiveIssues = cache(async (): Promise<DbIssue[]> => {
  if (!isDbEnabled()) return [];
  return prisma.issue.findMany({
    where: { status: { not: "ARCHIVED" }, underReview: false },
  });
});

function buildRankingItems(
  issues: DbIssue[],
  scoreOf: (issue: DbIssue, tally: VoteTally) => number,
): RankingItem[] {
  return issues
    .map((issue) => {
      const tally = tallyFromCounters(issue);
      return {
        issue: issueBrief(issue),
        voteTally: tally,
        commentCount: issue.commentCount,
        trendScore: scoreOf(issue, tally),
      };
    })
    .sort((a, b) => b.trendScore - a.trendScore)
    .slice(0, 50)
    .map((item, index) => ({ rank: index + 1, ...item }));
}

export const getIssues = cache(async (): Promise<Issue[]> => {
  if (!isDbEnabled()) return MOCK_ISSUES;

  const cached = await kvGetFast(issuesListCacheKey());
  if (cached) return JSON.parse(cached) as Issue[];

  const issues = await prisma.issue.findMany({
    where: { status: { not: "ARCHIVED" }, underReview: false },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const mapped = issues
    .map(mapIssue)
    .filter((i) => isIssueReadyForPublicFeed(i) && !isPendingArticlePlaceholder(i.summary));

  kvSetBackground(issuesListCacheKey(), JSON.stringify(mapped), BURST.issuesListCacheSec);
  return mapped;
});

export interface IssuesFeedResult {
  issues: Issue[];
  total: number;
  page: number;
  totalPages: number;
}

export async function getIssuesFeed(options: {
  category?: CategoryId;
  sort?: IssueSortId;
  page?: number;
  perPage?: number;
  live?: boolean;
  excludeIds?: string[];
}): Promise<IssuesFeedResult> {
  const {
    category,
    sort = "created",
    page = 1,
    perPage = HOME_FEED_PAGE_SIZE,
    live = false,
    excludeIds = [],
  } = options;

  let all = await getIssues();
  all = filterIssues(all, { excludeIds, live, category });
  all = sortIssuesList(all, sort);

  const total = all.length;
  const { items: issues, page: safePage, totalPages } = paginateIssues(all, page, perPage);

  return {
    issues,
    total,
    page: safePage,
    totalPages,
  };
}

export interface CommentPage {
  comments: Comment[];
  nextCursor: string | null;
}

/** コメント取得時に共通で使うinclude（投稿者情報・FC結果・1階層のみの返信を最大REPLY_LIMITS.visibleCount件） */
function commentInclude(withReplies: boolean) {
  return {
    user: { select: { id: true, name: true, plan: true } },
    fcCache: true,
    issue: { select: { category: true } },
    ...(withReplies
      ? {
          replies: {
            where: { isHidden: false },
            orderBy: { createdAt: "asc" as const },
            take: REPLY_LIMITS.visibleCount,
            include: {
              user: { select: { id: true, name: true, plan: true } },
              fcCache: true,
              issue: { select: { category: true } },
            },
          },
        }
      : {}),
  };
}

/** ページ内の全コメント＋返信の投稿者IDをまとめてユーザー統計バッチ取得するためのID一覧を作る */
function collectUserIds(rows: DbCommentWithUser[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.userId);
    for (const reply of row.replies ?? []) ids.add(reply.userId);
  }
  return [...ids];
}

/** ソートIDからPrismaのorderBy句を組み立てる。同値が並ぶ場合の並び順を安定させるため常にcreatedAt/idを併記する */
function commentOrderBy(sort: CommentSortId) {
  if (sort === "helpful") {
    return [{ helpfulCount: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }];
  }
  return [{ createdAt: "desc" as const }, { id: "desc" as const }];
}

export async function getComments(
  issueId: string,
  cursor?: string,
  limit = 20,
  sort: CommentSortId = "new",
  opts?: { includeReplies?: boolean },
): Promise<CommentPage> {
  if (!isDbEnabled()) return { comments: mockComments(issueId), nextCursor: null };

  const includeReplies = opts?.includeReplies !== false;
  const cursorKey = cursor ?? "first";
  const ver = await getCacheVersion(commentsVerKey(issueId));
  const cacheKey = `${commentsCacheKey(issueId, ver, cursorKey, limit, sort)}:r${includeReplies ? 1 : 0}`;

  try {
    const cached = await kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as CommentPage;
  } catch {
    // fall through
  }

  const rows = await prisma.comment.findMany({
    where: { issueId, isHidden: false, parentId: null },
    orderBy: commentOrderBy(sort),
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: commentInclude(includeReplies),
  });

  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows) as DbCommentWithUser[];
  const statsMap = await getUserPublicStatsBatch(collectUserIds(page));
  const result: CommentPage = {
    comments: page.map((row) => mapComment(row, statsMap)),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };

  try {
    await kv.set(cacheKey, JSON.stringify(result), { ex: BURST.commentsCacheSec });
  } catch {
    // ignore
  }
  return result;
}

/** 返信投稿直後にそのスレッド（親コメント＋返信一覧）だけを最新化するための単発取得 */
export async function getCommentById(id: string): Promise<Comment | null> {
  if (!isDbEnabled()) return null;

  const row = await prisma.comment.findFirst({
    where: { id, isHidden: false },
    include: commentInclude(true),
  });
  if (!row) return null;

  const statsMap = await getUserPublicStatsBatch(collectUserIds([row as DbCommentWithUser]));
  return mapComment(row as DbCommentWithUser, statsMap);
}

export interface DebateHighlights {
  for: Comment | null;
  against: Comment | null;
}

/**
 * 賛成派・反対派それぞれの「役に立った」最多コメントを1件ずつ返す（対決表示用）。
 * 議論が薄いうちは意味が無いため、呼び出し側は commentCount >= DEBATE_HIGHLIGHT_MIN_COMMENTS
 * のときだけ表示に使うこと（このAPI自体は件数に関わらず結果を返す）。
 * undecided（わからない派）は「立場」ではないため対決表示の対象にしない。
 */
/**
 * 賛成派・反対派それぞれの代表意見を1件ずつ返す（対決表示用）。
 * スプリットスレッド（getSplitComments）と同じ越境評価スコア（bridging）で選ぶ。
 * 単純helpfulCount順だと多数派バイアスがかかり「splitカラムはbridgingなのにバナーだけ多数派」という
 * 矛盾になるため統一する（2026-07-09、Phase 2-1）。helpfulCount=0の場合は代表意見なしとして扱う。
 */
export async function getDebateHighlights(issueId: string): Promise<DebateHighlights> {
  if (!isDbEnabled()) return { for: null, against: null };

  const ver = await getCacheVersion(commentsVerKey(issueId));
  const cacheKey = debateHighlightsCacheKey(issueId, ver);

  try {
    const cached = await kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as DebateHighlights;
  } catch {
    // fall through
  }

  const [forPage, againstPage] = await Promise.all([
    getSplitColumn(issueId, "FOR", undefined, 1),
    getSplitColumn(issueId, "AGAINST", undefined, 1),
  ]);
  const top = (page: SplitColumnPage): Comment | null => {
    const c = page.comments[0];
    return c && c.helpfulCount > 0 ? c : null;
  };

  const result: DebateHighlights = { for: top(forPage), against: top(againstPage) };

  try {
    await kv.set(cacheKey, JSON.stringify(result), { ex: BURST.commentsCacheSec });
  } catch {
    // ignore
  }
  return result;
}

export interface SplitColumnPage {
  comments: SplitComment[];
  nextCursor: string | null;
}

export interface SplitCommentPage {
  for: SplitColumnPage;
  against: SplitColumnPage;
}

interface BridgingCandidateRow {
  id: string;
  helpfulCount: number;
  crossHelpful: number;
  createdAt: Date;
}

// 異常に巨大なスレッドでのソートコストに対する防御的上限。通常のスレッドはこれよりずっと少ない
const SPLIT_SORT_FETCH_CAP = 2000;

/**
 * 指定した立場(stance)の候補コメント一覧を、helpfulCountと「相手陣営からのhelpful数(crossHelpful)」
 * 付きで取得する。スコア自体はここでは計算せず、呼び出し側でcomputeBridgingScore/sortByBridgingScoreに委ねる
 * （SQLとJSでロジックが二重管理にならないようにするため）。
 *
 * crossHelpfulの集計は組織票対策として、投票済み・UNDECIDED以外・MODERATION.newAccountCommentHours
 * 経過後のアカウントによるhelpfulのみを数える。
 */
async function fetchBridgingCandidates(
  issueId: string,
  stance: VoteChoice,
): Promise<BridgingCandidateRow[]> {
  const antiBrigadeCutoff = new Date(Date.now() - MODERATION.newAccountCommentHours * 60 * 60 * 1000);
  return prisma.$queryRaw<BridgingCandidateRow[]>`
    SELECT
      c.id,
      c."helpfulCount",
      c."createdAt",
      COALESCE(cross_counts.n, 0)::int AS "crossHelpful"
    FROM "Comment" c
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n
      FROM "Helpful" h
      JOIN "Vote" v ON v."userId" = h."userId" AND v."issueId" = c."issueId"
      JOIN "User" u ON u.id = h."userId"
      WHERE h."commentId" = c.id
        AND v.choice != c.stance
        AND v.choice != 'UNDECIDED'
        AND u."createdAt" <= ${antiBrigadeCutoff}
    ) cross_counts ON true
    WHERE c."issueId" = ${issueId}
      AND c."isHidden" = false
      AND c."parentId" IS NULL
      AND c.stance = ${stance}::"VoteChoice"
    ORDER BY c."createdAt" DESC
    LIMIT ${SPLIT_SORT_FETCH_CAP}
  `;
}

async function getSplitColumn(
  issueId: string,
  stance: VoteChoice,
  cursor: string | undefined,
  limit: number,
): Promise<SplitColumnPage> {
  const candidates = await fetchBridgingCandidates(issueId, stance);
  const sorted = sortByBridgingScore(candidates);

  let startIndex = 0;
  if (cursor) {
    const idx = sorted.findIndex((r) => r.id === cursor);
    startIndex = idx === -1 ? 0 : idx + 1;
  }
  const page = sorted.slice(startIndex, startIndex + limit + 1);
  const hasMore = page.length > limit;
  const pageRows = hasMore ? page.slice(0, limit) : page;
  if (pageRows.length === 0) return { comments: [], nextCursor: null };

  const idsToFetch = pageRows.map((r) => r.id);
  const crossHelpfulById = new Map(pageRows.map((r) => [r.id, r.crossHelpful]));

  const rows = await prisma.comment.findMany({
    where: { id: { in: idsToFetch } },
    include: commentInclude(false),
  });
  const byId = new Map(rows.map((r) => [r.id, r as DbCommentWithUser]));
  const ordered = idsToFetch
    .map((id) => byId.get(id))
    .filter((r): r is DbCommentWithUser => Boolean(r));

  const statsMap = await getUserPublicStatsBatch(collectUserIds(ordered));
  return {
    comments: ordered.map((row) => ({
      ...mapComment(row, statsMap),
      crossHelpful: crossHelpfulById.get(row.id) ?? 0,
    })),
    nextCursor: hasMore ? idsToFetch[idsToFetch.length - 1] : null,
  };
}

const AI_STEELMAN_CACHE_TTL_SEC = 6 * 60 * 60;

function buildSteelmanComment(issueId: string, stance: VoteChoice, argument: string): SplitComment {
  return {
    id: `ai-steelman-${issueId}-${stance}`,
    issueId,
    userId: "ai-steelman",
    userName: "論点提示AI",
    userPlan: "FREE",
    userCommentCount: 0,
    userTotalLikes: 0,
    stance: enumToChoice[stance],
    body: argument,
    likeCount: 0,
    dislikeCount: 0,
    helpfulCount: 0,
    verifiedBadge: false,
    fcResult: null,
    createdAt: new Date().toISOString(),
    parentId: null,
    replyCount: 0,
    replies: [],
    crossHelpful: 0,
    isAiSteelman: true,
  };
}

/**
 * カラムが空のとき、記事の材料から「その立場の最も筋が通った主張」をAIに代弁させる
 * （コールドスタート対策。人間が投稿すればcommentsVerKeyが上がりキャッシュごと自然に降格する＝
 * DBには一切保存しない）。生成失敗時は静かにnullを返し、空カラム表示にフォールバックする。
 */
async function getOrGenerateSteelman(
  issueId: string,
  stance: VoteChoice,
  ver: number,
): Promise<SplitComment | null> {
  const cacheKey = `cache:steelman:${issueId}:${stance}:${ver}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { argument: string } | null;
      return parsed?.argument ? buildSteelmanComment(issueId, stance, parsed.argument) : null;
    }
  } catch {
    // fall through
  }

  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { title: true, summaryJson: true },
  });
  if (!issue) return null;
  const summary = issue.summaryJson as unknown as IssueSummary;

  let argument = "";
  try {
    argument = await generateSteelman({
      issueTitle: issue.title,
      lead: summary.lead ?? "",
      bullets: summary.bullets ?? [],
      stance: stance === "FOR" ? "for" : "against",
    });
  } catch (e) {
    console.error("[getOrGenerateSteelman] failed", e);
  }

  try {
    await kv.set(cacheKey, JSON.stringify({ argument }), { ex: AI_STEELMAN_CACHE_TTL_SEC });
  } catch {
    // ignore
  }

  return argument ? buildSteelmanComment(issueId, stance, argument) : null;
}

/**
 * 賛成/反対2カラムのコメント取得（スプリットスレッド）。各カラムは越境評価スコアで並ぶ。
 * commentsVerKeyを流用するため、新規コメント投稿時は既存のgetComments同様に自動的にキャッシュが割れる
 * （helpfulタップ時はバージョンが上がらず最大30秒の遅延が生じる点はgetComments/helpfulソートと同じ既知の許容差）。
 * カラムが初回ロードで空の場合のみ、AIスティールマン（getOrGenerateSteelman）で埋める。
 */
export async function getSplitComments(
  issueId: string,
  opts?: { limit?: number; forCursor?: string; againstCursor?: string },
): Promise<SplitCommentPage> {
  if (!isDbEnabled()) {
    return { for: { comments: [], nextCursor: null }, against: { comments: [], nextCursor: null } };
  }

  const limit = opts?.limit ?? 20;
  const forCursorKey = opts?.forCursor ?? "first";
  const againstCursorKey = opts?.againstCursor ?? "first";
  const ver = await getCacheVersion(commentsVerKey(issueId));
  const forKey = splitCommentsCacheKey(issueId, ver, "for", forCursorKey, limit);
  const againstKey = splitCommentsCacheKey(issueId, ver, "against", againstCursorKey, limit);

  const [cachedFor, cachedAgainst] = await Promise.all([
    kv.get(forKey).catch(() => null),
    kv.get(againstKey).catch(() => null),
  ]);

  const [forPage, againstPage] = await Promise.all([
    cachedFor
      ? Promise.resolve(JSON.parse(cachedFor) as SplitColumnPage)
      : getSplitColumn(issueId, "FOR", opts?.forCursor, limit),
    cachedAgainst
      ? Promise.resolve(JSON.parse(cachedAgainst) as SplitColumnPage)
      : getSplitColumn(issueId, "AGAINST", opts?.againstCursor, limit),
  ]);

  // カラムが初回ロード（カーソル無し）で空のときだけAIスティールマンで埋める（load moreでは呼ばない）。
  // 人間が投稿すればcommentsVerKeyが上がりこのキャッシュごと自然に無効化＝降格する
  const [forSteelman, againstSteelman] = await Promise.all([
    !cachedFor && !opts?.forCursor && forPage.comments.length === 0
      ? getOrGenerateSteelman(issueId, "FOR", ver)
      : null,
    !cachedAgainst && !opts?.againstCursor && againstPage.comments.length === 0
      ? getOrGenerateSteelman(issueId, "AGAINST", ver)
      : null,
  ]);
  if (forSteelman) forPage.comments = [forSteelman];
  if (againstSteelman) againstPage.comments = [againstSteelman];

  try {
    if (!cachedFor) await kv.set(forKey, JSON.stringify(forPage), { ex: BURST.commentsCacheSec });
    if (!cachedAgainst)
      await kv.set(againstKey, JSON.stringify(againstPage), { ex: BURST.commentsCacheSec });
  } catch {
    // ignore
  }

  return { for: forPage, against: againstPage };
}

export interface IssueTimelineEntry {
  id: string;
  label: string;
  sourceUrl: string | null;
  at: string;
}

export async function getIssueTimeline(issueId: string, limit = 10): Promise<IssueTimelineEntry[]> {
  if (!isDbEnabled()) return [];

  const ver = await getCacheVersion(timelineVerKey(issueId));
  const cacheKey = timelineCacheKey(issueId, ver);

  try {
    const cached = await kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as IssueTimelineEntry[];
  } catch {
    // fall through
  }

  const rows = await prisma.issueTimeline.findMany({
    where: { issueId },
    orderBy: { at: "desc" },
    take: limit,
  });
  const mapped = rows.map((t) => ({
    id: t.id,
    label: t.label,
    sourceUrl: t.sourceUrl,
    at: t.at.toISOString(),
  }));

  try {
    await kv.set(cacheKey, JSON.stringify(mapped), { ex: BURST.timelineCacheSec });
  } catch {
    // ignore
  }
  return mapped;
}

/** trendScore = 投票数 + コメント数×10（仕様どおり単純な指標。アルゴリズム的な傾斜配分はしない） */
export const getRanking = cache(async (): Promise<RankingItem[]> => {
  if (!isDbEnabled()) return mockRanking();

  const cached = await kvGetFast(rankingCacheKey());
  if (cached) return JSON.parse(cached) as RankingItem[];

  const issues = await loadActiveIssues();
  const ranking = buildRankingItems(
    issues,
    (issue, tally) => tally.totalVotes + issue.commentCount * 10,
  );

  kvSetBackground(rankingCacheKey(), JSON.stringify(ranking), BURST.rankingCacheSec);
  return ranking;
});

/** 直近7日以内に作成された争点だけを対象にしたランキング。「今週Hot」用。 */
export const getWeeklyRanking = cache(async (limit = 5): Promise<RankingItem[]> => {
  if (!isDbEnabled()) return (await getRanking()).slice(0, limit);

  const cached = await kvGetFast(rankingWeeklyCacheKey());
  if (cached) {
    const parsed = JSON.parse(cached) as RankingItem[];
    return parsed.slice(0, limit);
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  const issues = (await loadActiveIssues()).filter(
    (issue) => issueCreatedAt(issue) >= sevenDaysAgo,
  );

  const ranking = buildRankingItems(
    issues,
    (issue, tally) => tally.totalVotes + issue.commentCount * 10,
  );

  kvSetBackground(rankingWeeklyCacheKey(), JSON.stringify(ranking), BURST.rankingCacheSec);
  return ranking.slice(0, limit);
});

/**
 * /ranking ページ専用。「Hotなスレ」=コメント数（議論の活発さ）、「Hotな投票」=投票数（得票の勢い）
 * で実際に異なる並び順にする（以前は表示名が違うだけで中身は同じtrendScoreだった）。
 */
export const getRankingBySort = cache(async (
  sortBy: "comments" | "votes",
  limit = 50,
): Promise<RankingItem[]> => {
  if (!isDbEnabled()) return (await getRanking()).slice(0, limit);

  const cacheKey = rankingBySortCacheKey(sortBy);
  const cached = await kvGetFast(cacheKey);
  if (cached) return (JSON.parse(cached) as RankingItem[]).slice(0, limit);

  const issues = await loadActiveIssues();
  const ranking = buildRankingItems(issues, (issue, tally) =>
    sortBy === "comments" ? issue.commentCount : tally.totalVotes,
  );

  kvSetBackground(cacheKey, JSON.stringify(ranking), BURST.rankingCacheSec);
  return ranking.slice(0, limit);
});

export interface BookmarkedIssue {
  slug: string;
  title: string;
  category: CategoryId;
}

/** サイドバー「保存したスレッド」用。直近保存順に最大N件。 */
export async function getBookmarkedIssues(userId: string, limit = 5): Promise<BookmarkedIssue[]> {
  if (!isDbEnabled()) return [];
  const rows = await prisma.bookmark.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { issue: { select: { slug: true, title: true, category: true } } },
  });
  return rows.map((r) => ({
    slug: r.issue.slug,
    title: r.issue.title,
    category: categoryToId[r.issue.category],
  }));
}

export interface ParticipatedIssue {
  slug: string;
  title: string;
  category: CategoryId;
  commentCount: number;
  /** このスレッドにコメントしたことがあるか（投票のみより優先表示） */
  hasCommented: boolean;
  /** 自分の最後の関与（投票 or 自分のコメント）より後に、他人のコメントが付いたか */
  hasUpdate: boolean;
}

const PARTICIPATED_CANDIDATE_POOL = 20;

/**
 * 左カラム「あなたが参加したスレッド」用。
 * - コメントしたスレッドを投票のみのスレッドより優先（深く関与した方を上に）
 * - 「更新あり」は Issue.updatedAt を見ない。投票のたびにIssue.updatedAtが動く（votes.ts）ため、
 *   人気スレッドはほぼ常にtrueになってしまいシグナルにならない。
 *   代わりに「自分の最後の関与より後に、自分以外の誰かがコメントしたか」で判定する。
 */
export async function getMyParticipatedIssues(userId: string, limit = 8): Promise<ParticipatedIssue[]> {
  if (!isDbEnabled()) return [];

  const votes = await prisma.vote.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: PARTICIPATED_CANDIDATE_POOL,
    select: { issueId: true, createdAt: true },
  });
  if (votes.length === 0) return [];
  const issueIds = votes.map((v) => v.issueId);

  const [myComments, othersComments, issues] = await Promise.all([
    prisma.comment.groupBy({
      by: ["issueId"],
      where: { issueId: { in: issueIds }, userId },
      _max: { createdAt: true },
    }),
    prisma.comment.groupBy({
      by: ["issueId"],
      where: { issueId: { in: issueIds }, userId: { not: userId } },
      _max: { createdAt: true },
    }),
    prisma.issue.findMany({
      where: { id: { in: issueIds } },
      select: { id: true, slug: true, title: true, category: true, commentCount: true },
    }),
  ]);

  const myLastCommentAt = new Map(myComments.map((c) => [c.issueId, c._max.createdAt!]));
  const othersLastCommentAt = new Map(othersComments.map((c) => [c.issueId, c._max.createdAt!]));
  const issueById = new Map(issues.map((i) => [i.id, i]));

  const merged = votes
    .map((v) => {
      const issue = issueById.get(v.issueId);
      if (!issue) return null;
      const myLastComment = myLastCommentAt.get(v.issueId) ?? null;
      const myLastActivity = myLastComment && myLastComment > v.createdAt ? myLastComment : v.createdAt;
      const othersLastComment = othersLastCommentAt.get(v.issueId) ?? null;
      return {
        slug: issue.slug,
        title: issue.title,
        category: categoryToId[issue.category],
        commentCount: issue.commentCount,
        hasCommented: myLastComment !== null,
        hasUpdate: othersLastComment !== null && othersLastComment > myLastActivity,
        myLastActivity,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  merged.sort((a, b) => {
    if (a.hasCommented !== b.hasCommented) return a.hasCommented ? -1 : 1;
    return b.myLastActivity.getTime() - a.myLastActivity.getTime();
  });

  return merged.slice(0, limit).map(({ myLastActivity: _myLastActivity, ...rest }) => rest);
}

export async function isBookmarked(userId: string, issueId: string): Promise<boolean> {
  if (!isDbEnabled()) return false;
  const row = await prisma.bookmark.findUnique({
    where: { userId_issueId: { userId, issueId } },
    select: { id: true },
  });
  return Boolean(row);
}
