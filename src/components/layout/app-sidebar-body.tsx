import Link from "next/link";
import { PlusTrialPromo } from "@/components/pricing/plus-trial-promo";
import { HotThreadList } from "@/components/issue/hot-thread-list";
import { BookmarkIcon, SettingsIcon, CreditCardIcon } from "@/components/ui/icons";
import { SidebarBookmarks } from "@/components/layout/sidebar-bookmarks";
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
        <HotThreadList title="今Hotなスレッド" items={hotNow} emptyMessage="まだ話題のスレッドがありません" />

        <HotThreadList
          title="今週Hotなスレッド"
          items={weekly}
          showRank
          emptyMessage="今週のスレッドはまだありません"
        />

        {plan === "FREE" && <PlusTrialPromo compact />}

        <div className="rounded-xl border border-border bg-surface-raised p-4">
          <div className="mb-3 flex items-center gap-1.5">
            <BookmarkIcon style={{ width: 14, height: 14 }} className="text-ink-secondary" />
            <p className="text-xs font-extrabold text-ink">保存したスレッド</p>
          </div>
          <SidebarBookmarks />
        </div>

        <div className="rounded-xl border border-border bg-surface-raised p-1.5">
          <Link
            href="/account"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-ink-secondary no-underline hover:bg-surface-muted hover:text-ink"
          >
            <SettingsIcon style={{ width: 15, height: 15 }} />
            設定
          </Link>
          <Link
            href="/pricing"
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold text-ink-secondary no-underline hover:bg-surface-muted hover:text-ink"
          >
            <CreditCardIcon style={{ width: 15, height: 15 }} />
            プラン管理
          </Link>
        </div>

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
