import { Suspense } from "react";
import { HomeFeed } from "@/components/home/home-feed";
import { HomeIntro } from "@/components/home/home-intro";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { SidebarSkeleton } from "@/components/layout/sidebar-skeleton";
import { LeftRail } from "@/components/layout/left-rail";
import { PageContainer } from "@/components/layout/page-container";
import { HOME_THREE_COL_GRID } from "@/lib/constants";
import { getIssues, getRankingBySort } from "@/lib/data";

// searchParams をサーバーで読むと dynamic 化して ISR が効かなくなる（毎回 Neon 直撃）
export const revalidate = 300;

export default async function HomePage() {
  const [allIssues, byVotes, byComments] = await Promise.all([
    getIssues(),
    getRankingBySort("votes", 5),
    getRankingBySort("comments", 5),
  ]);

  const byId = Object.fromEntries(allIssues.map((i) => [i.id, i]));
  const mostRead = byVotes[0] ? byId[byVotes[0].issue.id] : undefined;
  // 盛り上がり1位が読まれてると同じなら2位を使い、左右で別スレにする
  const mostActiveItem =
    byComments.find((r) => r.issue.id !== mostRead?.id) ?? byComments[0];
  const mostActive = mostActiveItem ? byId[mostActiveItem.issue.id] : undefined;

  const totalVoters = allIssues.reduce((sum, i) => sum + i.voteTally.totalVoters, 0);
  const totalComments = allIssues.reduce((sum, i) => sum + i.commentCount, 0);
  const participants = totalVoters + totalComments;

  return (
    <PageContainer>
      <div className={`grid gap-6 lg:gap-8 ${HOME_THREE_COL_GRID}`}>
        <div className="hidden xl:block">
          <LeftRail />
        </div>

        <div className="min-w-0 space-y-6">
          <Suspense fallback={null}>
            <HomeIntro participants={participants} />
          </Suspense>

          <Suspense fallback={null}>
            <HomeFeed
              allIssues={allIssues}
              mostRead={mostRead}
              mostActive={mostActive}
            />
          </Suspense>
        </div>

        <div className="hidden lg:block">
          <Suspense fallback={<SidebarSkeleton />}>
            <AppSidebarStatic />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}
