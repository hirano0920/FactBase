"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IssueCard } from "@/components/issue/issue-card";
import { HotIssueDuo } from "@/components/issue/hot-issue-card";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { FeedFilterBar } from "@/components/home/feed-filter-bar";
import { HomeIntro } from "@/components/home/home-intro";
import { HomeIssueExpand } from "@/components/home/home-issue-expand";
import { AdSlot } from "@/components/layout/page-container";
import { HOME_FEED_PAGE_SIZE, type CategoryId, type IssueSortId } from "@/lib/constants";
import { categoryCounts, filterIssues, sortIssuesList } from "@/lib/issues-feed-utils";
import type { Comment, Issue } from "@/types";

interface HomeFeedProps {
  allIssues: Issue[];
  mostRead?: Issue;
  mostActive?: Issue;
  participants: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function HomeFeed({ allIssues, mostRead, mostActive, participants }: HomeFeedProps) {
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
  const showHotDuo = !issueParam && Boolean(mostRead || mostActive);
  const excludeIds = useMemo(() => {
    if (!showHotDuo) return [] as string[];
    return [mostRead?.id, mostActive?.id].filter((id): id is string => Boolean(id));
  }, [showHotDuo, mostRead?.id, mostActive?.id]);

  const issueBySlug = useMemo(
    () => Object.fromEntries(allIssues.map((i) => [i.slug, i])),
    [allIssues],
  );
  const expandedIssue = expandedSlug ? (issueBySlug[expandedSlug] ?? null) : null;

  const pool = useMemo(
    () => filterIssues(allIssues, { excludeIds }),
    [allIssues, excludeIds],
  );

  const counts = useMemo(() => categoryCounts(pool), [pool]);

  const filtered = useMemo(
    () => sortIssuesList(filterIssues(pool, { category }), sort),
    [pool, category, sort],
  );

  // Debateファースト構成（戦略: Newsは入り口、Debateが本丸）。
  // 上段=アクティブなDebate（参加の総量順。「今盛り上がってる」が最初に見える）、
  // 下段=News・その他（ユーザー選択のソート順のまま）。
  const activeDebates = useMemo(() => {
    const debates = filtered.filter((i) => i.track === "debate");
    return [...debates]
      .sort(
        (a, b) =>
          b.voteTally.totalVotes + b.commentCount * 2 - (a.voteTally.totalVotes + a.commentCount * 2),
      )
      .slice(0, 15);
  }, [filtered]);
  const debateIds = useMemo(() => new Set(activeDebates.map((i) => i.id)), [activeDebates]);
  const restIssues = useMemo(() => filtered.filter((i) => !debateIds.has(i.id)), [filtered, debateIds]);

  const visibleCount = page * HOME_FEED_PAGE_SIZE;
  const pageIssues = useMemo(() => restIssues.slice(0, visibleCount), [restIssues, visibleCount]);
  const hasMore = restIssues.length > visibleCount;

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

  const groups = chunk(pageIssues, 2);

  return (
    <div className="space-y-6">
      <HomeIntro participants={participants} />

      {showHotDuo && (
        <ScrollReveal>
          <HotIssueDuo
            mostRead={mostRead}
            mostActive={mostActive}
            onSelect={openIssue}
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

      {activeDebates.length > 0 && (
        <section aria-label="議論が熱い争点">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-ink">
            🔥 議論が熱い
          </h2>
          <div className="grid gap-3">
            {activeDebates.map((issue, i) => (
              <ScrollReveal key={issue.id} delay={Math.min(i, 3) * 60}>
                <IssueCard issue={issue} hideResults onSelect={(opts) => openIssue(issue.slug, opts)} />
              </ScrollReveal>
            ))}
          </div>
        </section>
      )}

      {pageIssues.length === 0 && activeDebates.length === 0 ? (
        <p className="rounded-[20px] border border-border bg-surface-raised p-8 text-center text-sm text-ink-faint">
          該当するスレッドはまだありません
        </p>
      ) : (
        <div className="space-y-6">
          {pageIssues.length > 0 && (
            <h2 className="flex items-center gap-1.5 pt-2 text-sm font-bold text-ink">
              📰 新着ニュース・その他
            </h2>
          )}
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

      {hasMore && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-ink-secondary transition-colors hover:border-border-strong hover:bg-surface-muted"
          >
            もっと見る
          </button>
        </div>
      )}
    </div>
  );
}
