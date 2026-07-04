import { IssueCard } from "@/components/issue/issue-card";
import { HotIssueCard } from "@/components/issue/hot-issue-card";
import { TrendingTicker } from "@/components/issue/trending-ticker";
import { CategoryPills } from "@/components/issue/category-pills";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AdSlot, PageContainer } from "@/components/layout/page-container";
import { formatNumber } from "@/lib/utils";
import { type CategoryId, ISSUE_PAGE_REVALIDATE_SEC } from "@/lib/constants";
import { getIssues, getRanking } from "@/lib/data";

export const revalidate = ISSUE_PAGE_REVALIDATE_SEC;

export default async function HomePage() {
  const [issues, ranking] = await Promise.all([getIssues(), getRanking()]);

  const trending = ranking.slice(0, 4);
  const hotId = trending[0]?.issue.id;
  const hotIssue = hotId ? issues.find((i) => i.id === hotId) : undefined;
  const rest = issues.filter((i) => i.id !== hotIssue?.id);

  const totalVoters = issues.reduce((sum, i) => sum + i.voteTally.totalVoters, 0);
  const totalComments = issues.reduce((sum, i) => sum + i.commentCount, 0);
  const participants = totalVoters + totalComments;

  const counts: Partial<Record<CategoryId, number>> = {};
  for (const issue of issues) counts[issue.category] = (counts[issue.category] ?? 0) + 1;

  return (
    <PageContainer>
      {/* Xのように最初から2カラム: 左がフィード、右がサイドバー */}
      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-6">
          {participants > 0 && (
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised px-4 py-1.5 text-xs font-bold text-ink-secondary">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-pulse-hot rounded-full bg-hot" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-hot" />
              </span>
              累計{formatNumber(participants)}人が議論に参加中
            </div>
          )}
          <div>
            <h1 className="text-3xl font-extrabold leading-[1.1] tracking-tighter text-ink sm:text-4xl text-balance">
              日本の議論をもっと
              <br />
              分かりやすく、クリーンに。
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted">
              時事問題・政治・経済などを膨大な一次情報データベースをもとに、ファクトに基づいて分かりやすく解説。
              日本のあらゆる問題をリアルタイムでみんなで投票・議論できます。
            </p>
          </div>

          {trending.length > 0 && <TrendingTicker items={trending} />}

          {hotIssue && <HotIssueCard issue={hotIssue} />}

          <CategoryPills basePath="/issues" counts={counts} totalCount={issues.length} />

          <div className="grid gap-3">
            {rest.length > 0 ? (
              rest.map((issue) => <IssueCard key={issue.id} issue={issue} />)
            ) : (
              <p className="rounded-xl border border-border bg-surface-raised p-8 text-center text-sm text-ink-faint">
                新しい争点を準備中です
              </p>
            )}
          </div>

          <AdSlot />
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
