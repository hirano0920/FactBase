import Link from "next/link";
import { Suspense } from "react";
import { FlameIcon, TrendingUpIcon } from "@/components/ui/icons";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { SidebarSkeleton } from "@/components/layout/sidebar-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { RankingList } from "@/components/ranking/ranking-list";
import { cn } from "@/lib/utils";
import { getRankingBySort } from "@/lib/data";

interface RankingViewProps {
  sortBy: "comments" | "votes";
}

export async function RankingView({ sortBy }: RankingViewProps) {
  const isVotes = sortBy === "votes";
  const ranking = await getRankingBySort(sortBy, 50);

  return (
    <PageContainer>
      <header className="mb-6 max-w-content">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-ink">
          {isVotes ? (
            <TrendingUpIcon className="h-7 w-7 text-accent" />
          ) : (
            <FlameIcon className="h-7 w-7 text-accent" />
          )}
          {isVotes ? "Hotな投票" : "Hotなスレ"}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {isVotes
            ? "投票数が多く、得票の勢いがある争点です。"
            : "コメント数が多く、議論が活発な争点です。"}
        </p>
      </header>

      <div className="mb-6 flex gap-2">
        <Link
          href="/ranking"
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium no-underline transition-colors",
            !isVotes
              ? "border-accent bg-accent text-white"
              : "border-border text-ink-secondary hover:bg-surface-muted",
          )}
        >
          <FlameIcon className="h-4 w-4" /> Hotなスレ
        </Link>
        <Link
          href="/ranking/votes"
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium no-underline transition-colors",
            isVotes
              ? "border-accent bg-accent text-white"
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
