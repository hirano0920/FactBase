/**
 * 書き込み時のキャッシュ無効化。失敗しても本処理は成功させる（best-effort）。
 */
import { invalidateCachedIssue } from "@/lib/issue-cache";
import { revalidateAfterIssueUpdate } from "@/lib/revalidate-pages";
import {
  commentsVerKey,
  issuesListCacheKey,
  kv,
  rankingBySortCacheKey,
  rankingCacheKey,
  rankingWeeklyCacheKey,
  timelineVerKey,
} from "@/lib/redis";

async function safe(p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch {
    // ignore
  }
}

export async function invalidateRankingCaches(): Promise<void> {
  await Promise.all([
    safe(kv.del(rankingCacheKey())),
    safe(kv.del(rankingWeeklyCacheKey())),
    safe(kv.del(rankingBySortCacheKey("comments"))),
    safe(kv.del(rankingBySortCacheKey("votes"))),
  ]);
}

export async function invalidateIssuesListCache(): Promise<void> {
  await safe(kv.del(issuesListCacheKey()));
}

export async function bumpCommentsCache(issueId: string): Promise<void> {
  await safe(kv.incr(commentsVerKey(issueId)));
}

export async function bumpTimelineCache(issueId: string): Promise<void> {
  await safe(kv.incr(timelineVerKey(issueId)));
}

function safeRevalidate(slug?: string): void {
  try {
    revalidateAfterIssueUpdate(slug);
  } catch {
    // Route Handler 外では no-op
  }
}

/** 投票後: ランキングの trendScore が変わる */
export async function invalidateOnVote(_issueId: string, slug?: string): Promise<void> {
  await invalidateRankingCaches();
  if (slug) await safe(invalidateCachedIssue(slug));
  safeRevalidate(slug);
}

/** コメント投稿後 */
export async function invalidateOnCommentCreated(issueId: string, slug?: string): Promise<void> {
  await Promise.all([
    bumpCommentsCache(issueId),
    invalidateRankingCaches(),
    invalidateIssuesListCache(),
    slug ? safe(invalidateCachedIssue(slug)) : Promise.resolve(),
  ]);
  safeRevalidate(slug);
}

/** FC結果保存後: コメント一覧の fcResult 表示を更新 */
export async function invalidateOnFcResultSaved(issueId: string): Promise<void> {
  await bumpCommentsCache(issueId);
}

/** タイムライン追記後 */
export async function invalidateOnTimelineUpdated(issueId: string, slug?: string): Promise<void> {
  await Promise.all([
    bumpTimelineCache(issueId),
    slug ? safe(invalidateCachedIssue(slug)) : Promise.resolve(),
  ]);
  safeRevalidate(slug);
}

/** 争点公開・品質報告・非公開など */
export async function invalidateOnIssueChanged(slug?: string): Promise<void> {
  await Promise.all([
    invalidateIssuesListCache(),
    invalidateRankingCaches(),
    slug ? safe(invalidateCachedIssue(slug)) : Promise.resolve(),
  ]);
  safeRevalidate(slug);
}
