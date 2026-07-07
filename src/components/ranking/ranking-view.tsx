import Link from "next/link";
import { Suspense } from "react";
import { CategoryBadge } from "@/components/ui/badge";
import { ChartBarIcon, FlameIcon, MessageCircleIcon, TrendingUpIcon } from "@/components/ui/icons";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { SidebarSkeleton } from "@/components/layout/sidebar-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import { getRankingBySort } from "@/lib/data";
import type { RankingItem } from "@/types";

const RANK_BADGE_STYLE = [
  "bg-gradient-to-br from-hot to-warm text-white shadow-glow",
  "bg-gradient-to-br from-warm to-warm-hover text-white",
  "bg-surface-muted text-ink-secondary",
] as const;

interface RankingViewProps {
  sortBy: "comments" | "votes";
}

function RankingList({ ranking }: { ranking: RankingItem[] }) {
  if (ranking.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-surface-raised px-6 py-10 text-center text-sm text-ink-faint">
        まだ争点がありません
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {ranking.map((item, i) => (
        <Link
          key={item.issue.id}
          href={`/issues/${item.issue.slug}`}
          className={cn(
            "group flex animate-fade-slide-up items-center gap-4 rounded-2xl border border-border bg-surface-raised p-4 no-underline",
            "shadow-subtle transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card sm:p-5",
            item.rank === 1 && "border-hot-border bg-gradient-to-br from-hot-muted to-surface-raised",
          )}
          style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-extrabold tabular-nums",
              RANK_BADGE_STYLE[Math.min(item.rank - 1, 2)] ?? "bg-surface-muted text-ink-faint",
            )}
          >
            {item.rank}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1.5">
              <CategoryBadge category={item.issue.category} />
            </div>
            <p className="line-clamp-2 font-bold text-ink transition-colors group-hover:text-accent">
              {item.issue.title}
            </p>

            <div className="mt-2 flex h-1.5 max-w-xs overflow-hidden rounded-full bg-surface-muted">
              <div className="bg-for" style={{ width: `${item.voteTally.percents.for}%` }} />
              <div className="bg-against" style={{ width: `${item.voteTally.percents.against}%` }} />
              <div className="bg-neutral/50" style={{ width: `${item.voteTally.percents.undecided}%` }} />
            </div>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold tabular-nums text-ink-muted">
              <span className="text-for">賛成 {formatPercent(item.voteTally.percents.for)}</span>
              <span className="text-against">反対 {formatPercent(item.voteTally.percents.against)}</span>
              <span>わからない {formatPercent(item.voteTally.percents.undecided)}</span>
            </div>

            <div className="mt-2 flex items-center gap-3 text-sm tabular-nums text-ink-muted">
              <span className="flex items-center gap-1 text-xs font-semibold text-ink-faint">
                <ChartBarIcon style={{ width: 13, height: 13 }} />
                {formatNumber(item.voteTally.totalVoters)}
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold text-ink-faint">
                <MessageCircleIcon style={{ width: 13, height: 13 }} />
                {formatNumber(item.commentCount)}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export async function RankingView({ sortBy }: RankingViewProps) {
  const isVotes = sortBy === "votes";
  const ranking = await getRankingBySort(sortBy, 50);
  const totalVoters = ranking.reduce((sum, item) => sum + item.voteTally.totalVoters, 0);

  return (
    <PageContainer>
      <header className="relative mb-6 max-w-content">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-10 -top-16 -z-10 h-56 w-56 rounded-full bg-hot/15 blur-[70px] dark:bg-hot/20"
        />
        {totalVoters > 0 && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-hot-border bg-hot-muted px-3 py-1 text-xs font-bold text-hot">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-pulse-hot rounded-full bg-hot" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-hot" />
            </span>
            今この瞬間も{formatNumber(totalVoters)}人が投票中
          </div>
        )}
        <h1 className="flex items-center gap-2 bg-gradient-to-r from-ink to-hot bg-clip-text text-4xl font-extrabold tracking-tighter text-transparent">
          {isVotes ? <TrendingUpIcon className="h-8 w-8 text-hot" /> : <FlameIcon className="h-8 w-8 text-hot" />}
          {isVotes ? "Hotな投票" : "Hotなスレ"}
        </h1>
        <p className="mt-3 text-ink-muted">
          {isVotes
            ? "投票数が多く、得票の勢いがある争点です。"
            : "コメント数が多く、議論が活発な争点です。"}
        </p>
      </header>

      <div className="mb-6 flex gap-2">
        <Link
          href="/ranking"
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-bold no-underline transition-all",
            !isVotes
              ? "border-transparent bg-gradient-to-r from-accent to-accent-hover text-white shadow-subtle"
              : "border-border text-ink-secondary hover:bg-surface-muted",
          )}
        >
          <FlameIcon className="h-4 w-4" /> Hotなスレ
        </Link>
        <Link
          href="/ranking/votes"
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-bold no-underline transition-all",
            isVotes
              ? "border-transparent bg-gradient-to-r from-accent to-accent-hover text-white shadow-subtle"
              : "border-border text-ink-secondary hover:bg-surface-muted",
          )}
        >
          <TrendingUpIcon className="h-4 w-4" /> Hotな投票
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <RankingList ranking={ranking} />
        </div>

        <Suspense fallback={<SidebarSkeleton />}>
          <AppSidebarStatic />
        </Suspense>
      </div>
    </PageContainer>
  );
}
