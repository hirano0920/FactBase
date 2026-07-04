import { auth } from "@/auth";
import { getBookmarkedIssues, getGlobalTimeline, getRanking, getWeeklyRanking } from "@/lib/data";
import { AppSidebarBody } from "@/components/layout/app-sidebar-body";
import type { Plan } from "@prisma/client";

/**
 * X的な右カラム。トレンド・保存したスレッド・設定・Plus訴求をまとめる。
 * auth() を使うため ISR 対象ページでは AppSidebarStatic を使う。
 */
export async function AppSidebar() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const plan: Plan = session?.user?.plan ?? "FREE";

  const [ranking, weekly, bookmarks, liveTimeline] = await Promise.all([
    getRanking(),
    getWeeklyRanking(5),
    userId ? getBookmarkedIssues(userId, 5) : Promise.resolve([]),
    getGlobalTimeline(8),
  ]);

  return (
    <AppSidebarBody
      hotNow={ranking.slice(0, 5)}
      weekly={weekly}
      liveTimeline={liveTimeline}
      bookmarks={bookmarks}
      userId={userId}
      plan={plan}
    />
  );
}

/** 争点詳細など ISR ページ用。auth() なしで CDN キャッシュ可能 */
export async function AppSidebarStatic() {
  const [ranking, weekly, liveTimeline] = await Promise.all([
    getRanking(),
    getWeeklyRanking(5),
    getGlobalTimeline(8),
  ]);

  return (
    <AppSidebarBody
      hotNow={ranking.slice(0, 5)}
      weekly={weekly}
      liveTimeline={liveTimeline}
      bookmarks={[]}
      userId={null}
      plan="FREE"
    />
  );
}
