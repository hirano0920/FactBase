import { getStandingIssues } from "@/lib/data";
import { IssueCard } from "@/components/issue/issue-card";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section, SectionTitle } from "@/components/layout/page-container";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "常設debate",
  description: "夫婦別姓・死刑制度など、長年決着のついていない争点をいつでも議論できる常設ページ",
};

/**
 * 常設debate一覧。長年論争になってる争点(Issue.isStanding=true)を、日々のバズ記事とは別に
 * いつでも戻ってこられる場所として並べる。中身の選定・追加はオーナーが手動で行う運用なので、
 * ここは一覧表示のみ（発掘・自動選定ロジックは持たない）。
 */
export default async function StandingDebatesPage() {
  const issues = await getStandingIssues();

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 max-w-content">
          <Section>
            <SectionTitle>常設debate</SectionTitle>
            <p className="mb-5 text-sm text-ink-muted">
              夫婦別姓・死刑制度のように、長年決着のついていない争点を集めた常設ページです。ニュースと違って旬に関係なく、いつでも議論に戻ってこられます。
            </p>
            {issues.length === 0 ? (
              <p className="text-sm text-ink-faint">まだ常設debateが選定されていません。</p>
            ) : (
              <div className="space-y-3">
                {issues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} />
                ))}
              </div>
            )}
          </Section>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
