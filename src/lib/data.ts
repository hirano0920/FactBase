/**
 * データアクセス層。
 * DATABASE_URL があれば Prisma、なければ mock-data にフォールバック。
 * （フォールバックはNeon接続前のローカル開発・ビルド用）
 */
import { prisma } from "@/lib/prisma";
import {
  MOCK_ISSUES,
  getCommentsByIssueId as mockComments,
  getIssueBySlug as mockIssueBySlug,
  getRanking as mockRanking,
} from "@/lib/mock-data";
import { enumToChoice } from "@/lib/votes";
import { tierLabel } from "@/lib/badges";
import { CATEGORIES, BURST } from "@/lib/constants";
import { getCachedIssue, setCachedIssue } from "@/lib/issue-cache";
import {
  commentsCacheKey,
  commentsVerKey,
  globalTimelineCacheKey,
  globalTimelineVerKey,
  getCacheVersion,
  issuesListCacheKey,
  kv,
  rankingCacheKey,
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
import type { CategoryId, IssueStatus } from "@/lib/constants";

const CATEGORY_LABELS: Record<CategoryId, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label]),
) as Record<CategoryId, string>;
import type { Comment, FcVerdictId, Issue, IssueSummary, RankingItem, VoteTally } from "@/types";

export const isDbEnabled = () => Boolean(process.env.DATABASE_URL);

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
  user: Pick<DbUser, "id" | "name"> & {
    badges: { category: IssueCategory; tier: string }[];
  };
  fcCache: DbFcCache | null;
  issue: { category: IssueCategory };
};

function mapComment(comment: DbCommentWithUser): Comment {
  const badge = comment.user.badges.find((b) => b.category === comment.issue.category);
  return {
    id: comment.id,
    issueId: comment.issueId,
    userId: comment.userId,
    userName: comment.user.name ?? "名無しの議論者",
    userBadge: badge
      ? `${CATEGORY_LABELS[categoryToId[badge.category]]} ${tierLabel(badge.tier)}`
      : null,
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
  };
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

export async function getIssues(): Promise<Issue[]> {
  if (!isDbEnabled()) return MOCK_ISSUES;

  try {
    const cached = await kv.get(issuesListCacheKey());
    if (cached) return JSON.parse(cached) as Issue[];
  } catch {
    // fall through
  }

  const issues = await prisma.issue.findMany({
    // underReview中は一覧・トレンドから外す（人間確認が終わるまで新規流入させない）
    where: { status: { not: "ARCHIVED" }, underReview: false },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const mapped = issues.map(mapIssue);

  try {
    await kv.set(issuesListCacheKey(), JSON.stringify(mapped), { ex: BURST.issuesListCacheSec });
  } catch {
    // ignore
  }
  return mapped;
}

export interface CommentPage {
  comments: Comment[];
  nextCursor: string | null;
}

export async function getComments(
  issueId: string,
  cursor?: string,
  limit = 20,
): Promise<CommentPage> {
  if (!isDbEnabled()) return { comments: mockComments(issueId), nextCursor: null };

  const cursorKey = cursor ?? "first";
  const ver = await getCacheVersion(commentsVerKey(issueId));
  const cacheKey = commentsCacheKey(issueId, ver, cursorKey, limit);

  try {
    const cached = await kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as CommentPage;
  } catch {
    // fall through
  }

  const rows = await prisma.comment.findMany({
    where: { issueId, isHidden: false },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      user: {
        select: {
          id: true,
          name: true,
          badges: { select: { category: true, tier: true } },
        },
      },
      fcCache: true,
      issue: { select: { category: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const result: CommentPage = {
    comments: page.map(mapComment),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };

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
export async function getGlobalTimeline(limit = 8): Promise<GlobalTimelineEntry[]> {
  if (!isDbEnabled()) return [];

  const ver = await getCacheVersion(globalTimelineVerKey());
  const cacheKey = globalTimelineCacheKey(ver);

  try {
    const cached = await kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as GlobalTimelineEntry[];
  } catch {
    // fall through
  }

  const rows = await prisma.issueTimeline.findMany({
    orderBy: { at: "desc" },
    take: limit,
    include: {
      issue: { select: { slug: true, title: true, underReview: true } },
    },
  });

  const mapped = rows
    .filter((t) => !t.issue.underReview)
    .map((t) => ({
      id: t.id,
      label: t.label,
      sourceUrl: t.sourceUrl,
      at: t.at.toISOString(),
      issueSlug: t.issue.slug,
      issueTitle: t.issue.title,
    }));

  try {
    await kv.set(cacheKey, JSON.stringify(mapped), { ex: BURST.globalTimelineCacheSec });
  } catch {
    // ignore
  }
  return mapped;
}

/** trendScore = 投票数 + コメント数×10（仕様どおり単純な指標。アルゴリズム的な傾斜配分はしない） */
export async function getRanking(): Promise<RankingItem[]> {
  if (!isDbEnabled()) return mockRanking();

  try {
    const cached = await kv.get(rankingCacheKey());
    if (cached) return JSON.parse(cached) as RankingItem[];
  } catch {
    // fall through
  }

  const issues = await prisma.issue.findMany({
    where: { status: { not: "ARCHIVED" }, underReview: false },
  });

  const ranking = issues
    .map((issue) => {
      const tally = tallyFromCounters(issue);
      return {
        issue: {
          id: issue.id,
          slug: issue.slug,
          title: issue.title,
          category: categoryToId[issue.category],
          status: statusToId[issue.status],
        },
        voteTally: tally,
        commentCount: issue.commentCount,
        trendScore: tally.totalVotes + issue.commentCount * 10,
      };
    })
    .sort((a, b) => b.trendScore - a.trendScore)
    .slice(0, 50)
    .map((item, index) => ({ rank: index + 1, ...item }));

  try {
    await kv.set(rankingCacheKey(), JSON.stringify(ranking), { ex: BURST.rankingCacheSec });
  } catch {
    // ignore
  }
  return ranking;
}

/** 直近7日以内に作成された争点だけを対象にしたランキング。「今週Hot」用。 */
export async function getWeeklyRanking(limit = 5): Promise<RankingItem[]> {
  if (!isDbEnabled()) return (await getRanking()).slice(0, limit);

  try {
    const cached = await kv.get(rankingWeeklyCacheKey());
    if (cached) {
      const parsed = JSON.parse(cached) as RankingItem[];
      return parsed.slice(0, limit);
    }
  } catch {
    // fall through
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);
  const issues = await prisma.issue.findMany({
    where: { status: { not: "ARCHIVED" }, underReview: false, createdAt: { gte: sevenDaysAgo } },
  });

  const ranking = issues
    .map((issue) => {
      const tally = tallyFromCounters(issue);
      return {
        issue: {
          id: issue.id,
          slug: issue.slug,
          title: issue.title,
          category: categoryToId[issue.category],
          status: statusToId[issue.status],
        },
        voteTally: tally,
        commentCount: issue.commentCount,
        trendScore: tally.totalVotes + issue.commentCount * 10,
      };
    })
    .sort((a, b) => b.trendScore - a.trendScore)
    .slice(0, 50)
    .map((item, index) => ({ rank: index + 1, ...item }));

  try {
    await kv.set(rankingWeeklyCacheKey(), JSON.stringify(ranking), { ex: BURST.rankingCacheSec });
  } catch {
    // ignore
  }
  return ranking.slice(0, limit);
}

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
