import { Suspense } from "react";
import { HomeFeed } from "@/components/home/home-feed";
import { HomeIntro } from "@/components/home/home-intro";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { SidebarSkeleton } from "@/components/layout/sidebar-skeleton";
import { ParticipatedRail } from "@/components/layout/participated-rail";
import { IssueSearchBox } from "@/components/layout/issue-search-box";
import { StickySidebar } from "@/components/layout/sticky-sidebar";
import { PageContainer } from "@/components/layout/page-container";
import { HOME_THREE_COL_GRID } from "@/lib/constants";
import { getIssues, getRanking } from "@/lib/data";

// searchParams をサーバーで読むと dynamic 化して ISR が効かなくなる（毎回 Neon 直撃）
export const revalidate = 300;

export default async function HomePage() {
  const [allIssues, ranking] = await Promise.all([getIssues(), getRanking()]);

  const hotId = ranking[0]?.issue.id;
  const hotIssue = hotId ? allIssues.find((i) => i.id === hotId) : undefined;

  const totalVoters = allIssues.reduce((sum, i) => sum + i.voteTally.totalVoters, 0);
  const totalComments = allIssues.reduce((sum, i) => sum + i.commentCount, 0);
  const participants = totalVoters + totalComments;

  return (
    <PageContainer>
      <div className={`grid gap-6 lg:gap-8 ${HOME_THREE_COL_GRID}`}>
        <div className="hidden xl:block xl:self-start">
          <StickySidebar>
            <div className="space-y-4">
              <IssueSearchBox />
              <ParticipatedRail />
            </div>
          </StickySidebar>
        </div>

        <div className="min-w-0 space-y-6">
          <Suspense fallback={null}>
            <HomeIntro participants={participants} />
          </Suspense>

          <Suspense fallback={null}>
            <HomeFeed allIssues={allIssues} hotIssue={hotIssue} />
          </Suspense>
        </div>

        <div className="hidden lg:block lg:self-start">
          <Suspense fallback={<SidebarSkeleton />}>
            <AppSidebarStatic />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}
