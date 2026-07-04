import { PageContainer } from "@/components/layout/page-container";
import { IssueCard } from "@/components/issue/issue-card";
import { CategoryPills } from "@/components/issue/category-pills";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CATEGORIES, type CategoryId, ISSUE_PAGE_REVALIDATE_SEC } from "@/lib/constants";
import { getIssues } from "@/lib/data";

export const metadata = {
  title: "争点一覧",
};

export const revalidate = ISSUE_PAGE_REVALIDATE_SEC;

interface IssuesPageProps {
  searchParams: Promise<{ category?: string }>;
}

export default async function IssuesPage({ searchParams }: IssuesPageProps) {
  const [issues, { category }] = await Promise.all([getIssues(), searchParams]);

  const activeCategory = CATEGORIES.some((c) => c.id === category)
    ? (category as CategoryId)
    : undefined;

  const counts: Partial<Record<CategoryId, number>> = {};
  for (const issue of issues) counts[issue.category] = (counts[issue.category] ?? 0) + 1;

  const filtered = activeCategory ? issues.filter((i) => i.category === activeCategory) : issues;

  return (
    <PageContainer>
      <header className="mb-6 max-w-content">
        <h1 className="text-3xl font-extrabold tracking-tighter text-ink">争点</h1>
        <p className="mt-2 text-ink-muted">
          いま国会・社会で議論されている争点です。投票と議論に参加できます。
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-6">
          <CategoryPills
            basePath="/issues"
            activeCategory={activeCategory}
            counts={counts}
            totalCount={issues.length}
          />

          <div className="grid gap-3">
            {filtered.length > 0 ? (
              filtered.map((issue) => <IssueCard key={issue.id} issue={issue} />)
            ) : (
              <p className="rounded-xl border border-border bg-surface-raised p-8 text-center text-sm text-ink-faint">
                該当する争点はまだありません
              </p>
            )}
          </div>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
