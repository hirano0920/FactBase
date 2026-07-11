"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IssueCard } from "@/components/issue/issue-card";
import { HotIssueCard } from "@/components/issue/hot-issue-card";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
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
  const [scrollToVote, setScrollToVote] = useState(false);

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
    (slug: string, opts?: { scrollToVote?: boolean }) => {
      setExpandedSlug(slug);
      setScrollToVote(Boolean(opts?.scrollToVote));
      router.replace(`/?issue=${encodeURIComponent(slug)}`, { scroll: false });
      // smoothスクロールだと、アニメーション中にフィード→記事詳細へコンテンツが
      // 丸ごと入れ替わり、旧レイアウトの上をスクロールしている間にヒーローが
      // 一瞬見えて消えるような引っかかりが出るため、瞬時に切り替える
      window.scrollTo({ top: 0, behavior: "auto" });
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
        <HomeIssueExpand
          issue={expandedIssue}
          guestComments={expandedComments}
          onBack={closeIssue}
          scrollToVote={scrollToVote}
        />
      </div>
    );
  }

  const groups = chunk(pageIssues, 3);

  return (
    <div className="space-y-6">
      {displayHotIssue && (
        <ScrollReveal>
          <HotIssueCard
            issue={displayHotIssue}
            hideResults
            onSelect={(opts) => openIssue(displayHotIssue.slug, opts)}
          />
        </ScrollReveal>
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
        <p className="rounded-[20px] border border-border bg-surface-raised p-8 text-center text-sm text-ink-faint">
          該当するスレッドはまだありません
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group, gi) => (
            <div key={gi} className="space-y-3">
              <div className="grid gap-3">
                {group.map((issue, gIndex) => (
                  <ScrollReveal key={issue.id} delay={gIndex * 60}>
                    <IssueCard
                      issue={issue}
                      hideResults
                      onSelect={(opts) => openIssue(issue.slug, opts)}
                    />
                  </ScrollReveal>
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
