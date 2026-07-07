import { cache } from "react";
import { auth } from "@/auth";
import { getRanking, getWeeklyRanking } from "@/lib/data";
import { AppSidebarBody } from "@/components/layout/app-sidebar-body";
import type { Plan } from "@prisma/client";

/** サイドバー用データ。同一リクエスト内で重複取得しない。LIVEはクライアント側で遅延取得。 */
export const getSidebarData = cache(async () => {
  const [ranking, weekly] = await Promise.all([getRanking(), getWeeklyRanking(5)]);
  return { ranking, weekly };
});

/**
 * ログイン状態でプラン表示が必要なページ用（アカウント等）。
 * ホーム・ランキングは AppSidebarStatic + Suspense を使うこと。
 */
export async function AppSidebar() {
  const session = await auth();
  const plan: Plan = session?.user?.plan ?? "FREE";
  const { ranking, weekly } = await getSidebarData();

  return (
    <AppSidebarBody
      hotNow={ranking.slice(0, 5)}
      weekly={weekly}
      liveEntries={[]}
      plan={plan}
    />
  );
}

/** ISR 可能なページ用。auth() なし・DBクエリ最小。 */
export async function AppSidebarStatic() {
  const { ranking, weekly } = await getSidebarData();

  return (
    <AppSidebarBody
      hotNow={ranking.slice(0, 5)}
      weekly={weekly}
      liveEntries={[]}
      plan="FREE"
    />
  );
}
