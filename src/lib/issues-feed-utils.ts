import { HOME_FEED_PAGE_SIZE, type CategoryId, type IssueSortId } from "@/lib/constants";
import { isIssueReadyForPublicFeed, isPendingArticlePlaceholder } from "@/lib/radar";
import type { Issue } from "@/types";

export function sortIssuesList(issues: Issue[], sort: IssueSortId): Issue[] {
  const copy = [...issues];
  if (sort === "comments") {
    copy.sort((a, b) => b.commentCount - a.commentCount);
  } else if (sort === "votes") {
    copy.sort((a, b) => b.voteTally.totalVotes - a.voteTally.totalVotes);
  } else {
    copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  return copy;
}

export function filterIssues(
  issues: Issue[],
  opts: { category?: CategoryId; live?: boolean; excludeIds?: string[] },
): Issue[] {
  let result = issues.filter((i) => !opts.excludeIds?.includes(i.id));
  result = result.filter(
    (i) => isIssueReadyForPublicFeed(i) && !isPendingArticlePlaceholder(i.summary),
  );
  if (opts.live) result = result.filter((i) => i.confirmation === "reported");
  if (opts.category) result = result.filter((i) => i.category === opts.category);
  return result;
}

export function paginateIssues<T>(items: T[], page: number, perPage = HOME_FEED_PAGE_SIZE) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    total,
    page: safePage,
    totalPages,
  };
}

export function categoryCounts(issues: Issue[]): Partial<Record<CategoryId, number>> {
  const counts: Partial<Record<CategoryId, number>> = {};
  for (const issue of issues) counts[issue.category] = (counts[issue.category] ?? 0) + 1;
  return counts;
}
