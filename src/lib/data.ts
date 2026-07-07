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
  REPLY_LIMITS,
  type CategoryId,
  type CommentSortId,
  type IssueSortId,
  type IssueStatus,
} from "@/lib/constants";
import { getUserPublicStatsBatch } from "@/lib/user-stats";
import { isIssueReadyForPublicFeed, isPendingArticlePlaceholder } from "@/lib/radar";
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
  globalTimelineCacheKey,
  globalTimelineVerKey,
  getCacheVersion,
  issuesListCacheKey,
  kv,
  rankingCacheKey,
  rankingBySortCacheKey,
  rankingWeeklyCacheKey,
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
} from "@prisma/client";
import type { Comment, FcVerdictId, Issue, IssueSummary, RankingItem, VoteTally } from "@/types";

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
  return {
    id: issue.id,
    slug: issue.slug,
    title: issue.title,
    category: categoryToId[issue.category],
    status: statusToId[issue.status],
    summary: issue.summaryJson as unknown as IssueSummary,
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
    underReview: issue.underReview,
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

  const [forRow, againstRow] = await Promise.all([
    prisma.comment.findFirst({
      where: { issueId, isHidden: false, parentId: null, stance: "FOR", helpfulCount: { gt: 0 } },
      orderBy: [{ helpfulCount: "desc" }, { likeCount: "desc" }, { createdAt: "desc" }],
      include: commentInclude(false),
    }),
    prisma.comment.findFirst({
      where: { issueId, isHidden: false, parentId: null, stance: "AGAINST", helpfulCount: { gt: 0 } },
      orderBy: [{ helpfulCount: "desc" }, { likeCount: "desc" }, { createdAt: "desc" }],
      include: commentInclude(false),
    }),
  ]);

  const statsMap = await getUserPublicStatsBatch(
    collectUserIds(
      [forRow, againstRow].filter((r): r is NonNullable<typeof r> => Boolean(r)) as DbCommentWithUser[],
    ),
  );
  const toComment = (row: typeof forRow) =>
    row ? mapComment(row as DbCommentWithUser, statsMap) : null;

  const result: DebateHighlights = { for: toComment(forRow), against: toComment(againstRow) };

  try {
    await kv.set(cacheKey, JSON.stringify(result), { ex: BURST.commentsCacheSec });
  } catch {
    // ignore
  }
  return result;
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

export interface GlobalTimelineEntry extends IssueTimelineEntry {
  issueSlug: string;
  issueTitle: string;
}

/** 全争点横断の最新タイムライン（サイドバー LIVE フィード用） */
export const getGlobalTimeline = cache(async (limit = 8): Promise<GlobalTimelineEntry[]> => {
  if (!isDbEnabled()) return [];

  const ver = await getCacheVersion(globalTimelineVerKey());
  const cacheKey = globalTimelineCacheKey(ver);

  const cached = await kvGetFast(cacheKey);
  if (cached) return JSON.parse(cached) as GlobalTimelineEntry[];

  const rows = await prisma.issueTimeline.findMany({
    where: {
      issue: {
        status: { not: "ARCHIVED" },
        underReview: false,
        confirmation: "REPORTED",
      },
    },
    orderBy: { at: "desc" },
    take: limit,
    include: {
      issue: { select: { slug: true, title: true } },
    },
  });

  const mapped = rows.map((t) => ({
    id: t.id,
    label: t.label,
    sourceUrl: t.sourceUrl,
    at: t.at.toISOString(),
    issueSlug: t.issue.slug,
    issueTitle: t.issue.title,
  }));

  kvSetBackground(cacheKey, JSON.stringify(mapped), BURST.globalTimelineCacheSec);
  return mapped;
});

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

export async function isBookmarked(userId: string, issueId: string): Promise<boolean> {
  if (!isDbEnabled()) return false;
  const row = await prisma.bookmark.findUnique({
    where: { userId_issueId: { userId, issueId } },
    select: { id: true },
  });
  return Boolean(row);
}
