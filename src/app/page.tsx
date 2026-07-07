import { Suspense } from "react";
import { HomeFeed } from "@/components/home/home-feed";
import { HomeIntro } from "@/components/home/home-intro";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { SidebarSkeleton } from "@/components/layout/sidebar-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { MAIN_SIDEBAR_GRID } from "@/lib/constants";
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
      <div className={`grid gap-8 ${MAIN_SIDEBAR_GRID}`}>
        <div className="min-w-0 space-y-6">
          <Suspense fallback={null}>
            <HomeIntro participants={participants} />
          </Suspense>

          <Suspense fallback={null}>
            <HomeFeed allIssues={allIssues} hotIssue={hotIssue} />
          </Suspense>
        </div>

        <Suspense fallback={<SidebarSkeleton />}>
          <AppSidebarStatic />
        </Suspense>
      </div>
    </PageContainer>
  );
}
