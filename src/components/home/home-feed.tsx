"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IssueCard } from "@/components/issue/issue-card";
import { HotIssueCard } from "@/components/issue/hot-issue-card";
import { FeedFilterBar } from "@/components/home/feed-filter-bar";
import { HomeIssueExpand } from "@/components/home/home-issue-expand";
import { PaginationBar } from "@/components/home/pagination-bar";
import { AdSlot } from "@/components/layout/page-container";
import { type CategoryId, type IssueSortId } from "@/lib/constants";
import {
  categoryCounts,
  filterIssues,
  paginateIssues,
  sortIssuesList,
} from "@/lib/issues-feed-utils";
import type { Comment, Issue } from "@/types";

interface HomeFeedProps {
  allIssues: Issue[];
  hotIssue?: Issue;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function HomeFeed({ allIssues, hotIssue }: HomeFeedProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [category, setCategory] = useState<CategoryId | undefined>();
  const [sort, setSort] = useState<IssueSortId>("created");
  const [page, setPage] = useState(1);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [expandedComments, setExpandedComments] = useState<Comment[]>([]);

  useEffect(() => {
    setExpandedSlug(searchParams.get("issue"));
  }, [searchParams]);

  const issueParam = searchParams.get("issue");
  const displayHotIssue = issueParam ? undefined : hotIssue;

  const issueBySlug = useMemo(
    () => Object.fromEntries(allIssues.map((i) => [i.slug, i])),
    [allIssues],
  );
  const expandedIssue = expandedSlug ? (issueBySlug[expandedSlug] ?? null) : null;

  const pool = useMemo(
    () => filterIssues(allIssues, { excludeIds: displayHotIssue ? [displayHotIssue.id] : [] }),
    [allIssues, displayHotIssue],
  );

  const counts = useMemo(() => categoryCounts(pool), [pool]);

  const filtered = useMemo(
    () => sortIssuesList(filterIssues(pool, { category }), sort),
    [pool, category, sort],
  );

  const { items: pageIssues, totalPages } = useMemo(
    () => paginateIssues(filtered, page),
    [filtered, page],
  );

  useEffect(() => {
    if (!expandedIssue) {
      setExpandedComments([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/comments?issueId=${encodeURIComponent(expandedIssue.id)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { comments: Comment[] };
        if (!cancelled) setExpandedComments(data.comments);
      } catch {
        /* guest表示のまま */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedIssue]);

  const openIssue = useCallback(
    (slug: string) => {
      setExpandedSlug(slug);
      router.replace(`/?issue=${encodeURIComponent(slug)}`, { scroll: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [router],
  );

  const closeIssue = useCallback(() => {
    setExpandedSlug(null);
    router.replace("/", { scroll: false });
  }, [router]);

  const onCategoryChange = useCallback((c?: CategoryId) => {
    setCategory(c);
    setPage(1);
  }, []);

  const onSortChange = useCallback((s: IssueSortId) => {
    setSort(s);
    setPage(1);
  }, []);

  if (expandedIssue) {
    return (
      <div className="home-expand-enter">
        <HomeIssueExpand issue={expandedIssue} guestComments={expandedComments} onBack={closeIssue} />
      </div>
    );
  }

  const groups = chunk(pageIssues, 4);

  return (
    <div className="space-y-6">
      {displayHotIssue && (
        <HotIssueCard issue={displayHotIssue} hideResults onSelect={() => openIssue(displayHotIssue.slug)} />
      )}

      <FeedFilterBar
        activeCategory={category}
        activeSort={sort}
        counts={counts}
        totalCount={pool.length}
        onCategoryChange={onCategoryChange}
        onSortChange={onSortChange}
      />

      {pageIssues.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface-raised p-8 text-center text-sm text-ink-faint">
          該当するスレッドはまだありません
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group, gi) => (
            <div key={gi} className="space-y-3">
              <div className="grid gap-3">
                {group.map((issue) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    hideResults
                    onSelect={() => openIssue(issue.slug)}
                  />
                ))}
              </div>
              <AdSlot />
            </div>
          ))}
        </div>
      )}

      <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
