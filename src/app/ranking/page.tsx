import Link from "next/link";
import { CategoryBadge } from "@/components/ui/badge";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section } from "@/components/layout/page-container";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import { getRanking, getWeeklyRanking } from "@/lib/data";

export const metadata = {
  title: "ランキング",
};

// Next.jsのセグメント設定はリテラルのみ許可のため、lib/constants.tsのISSUE_PAGE_REVALIDATE_SEC(3600)と値を同期
export const revalidate = 3600;

interface RankingPageProps {
  searchParams: Promise<{ period?: string }>;
}

export default async function RankingPage({ searchParams }: RankingPageProps) {
  const { period } = await searchParams;
  const isWeekly = period === "week";

  const ranking = isWeekly ? await getWeeklyRanking(50) : await getRanking();

  return (
    <PageContainer>
      <header className="mb-6 max-w-content">
        <h1 className="text-3xl font-extrabold tracking-tighter text-ink">
          {isWeekly ? "📈 Hotな投票" : "🔥 Hotなスレ"}
        </h1>
        <p className="mt-3 text-ink-muted">
          {isWeekly
            ? "直近7日以内に生まれた争点のうち、いま最も盛り上がっているものです。"
            : "投票数と注目度にもとづく、いま最も盛り上がっている争点です。"}
        </p>
      </header>

      <div className="mb-6 flex gap-2">
        <Link
          href="/ranking"
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm font-bold no-underline transition-colors",
            !isWeekly ? "border-ink bg-ink text-surface" : "border-border text-ink-secondary hover:bg-surface-muted",
          )}
        >
          🔥 Hotなスレ
        </Link>
        <Link
          href="/ranking?period=week"
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm font-bold no-underline transition-colors",
            isWeekly ? "border-ink bg-ink text-surface" : "border-border text-ink-secondary hover:bg-surface-muted",
          )}
        >
          📈 Hotな投票（週間）
        </Link>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <Section className="min-w-0 divide-y divide-border p-0">
          {ranking.length > 0 ? (
            ranking.map((item) => (
              <Link
                key={item.issue.id}
                href={`/issues/${item.issue.slug}`}
                className="flex items-center gap-4 px-6 py-5 no-underline transition-colors hover:bg-surface-muted sm:px-8"
              >
                <span className="w-8 shrink-0 text-2xl font-extrabold tabular-nums text-ink-faint">
                  {item.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5">
                    <CategoryBadge category={item.issue.category} />
                  </div>
                  <p className="truncate font-bold text-ink">{item.issue.title}</p>
                  <p className="mt-1 text-sm tabular-nums text-ink-muted">
                    賛成 {formatPercent(item.voteTally.percents.for)} ·{" "}
                    {formatNumber(item.voteTally.totalVoters)}人
                  </p>
                </div>
              </Link>
            ))
          ) : (
            <p className="px-6 py-10 text-center text-sm text-ink-faint sm:px-8">
              {isWeekly ? "今週作られた争点はまだありません" : "まだ争点がありません"}
            </p>
          )}
        </Section>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
