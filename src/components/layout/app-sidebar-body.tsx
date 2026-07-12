import Link from "next/link";
import { PlusTrialPromo } from "@/components/pricing/plus-trial-promo";
import { HotThreadList } from "@/components/issue/hot-thread-list";
import { StickySidebar } from "@/components/layout/sticky-sidebar";
import { SITE } from "@/lib/constants";
import type { RankingItem } from "@/types";
import type { Plan } from "@prisma/client";

interface AppSidebarBodyProps {
  hotNow: RankingItem[];
  weekly: RankingItem[];
  plan: Plan;
}

export function AppSidebarBody({
  hotNow,
  weekly,
  plan,
}: AppSidebarBodyProps) {
  return (
    <StickySidebar>
      <aside className="space-y-4">
        {plan === "FREE" && <PlusTrialPromo compact />}

        <HotThreadList title="今Hotなスレッド" items={hotNow} emptyMessage="まだ話題のスレッドがありません" />

        <HotThreadList
          title="今週Hotなスレッド"
          items={weekly}
          showRank
          emptyMessage="今週のスレッドはまだありません"
        />

        <p className="px-1 text-xs leading-relaxed text-ink-faint">
          <Link href="/about" className="hover:text-ink-secondary">
            {SITE.name}を知る
          </Link>
          {" · "}
          <Link href="/transparency" className="hover:text-ink-secondary">
            透明性
          </Link>
          {" · "}
          <Link href="/pricing" className="hover:text-ink-secondary">
            料金
          </Link>
          <br />© {SITE.name}
        </p>
      </aside>
    </StickySidebar>
  );
}
