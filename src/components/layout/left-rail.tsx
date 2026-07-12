import Link from "next/link";
import { IssueSearchBox } from "@/components/layout/issue-search-box";
import { ParticipatedRail } from "@/components/layout/participated-rail";
import { SidebarBookmarks } from "@/components/layout/sidebar-bookmarks";
import { BookmarkIcon, SettingsIcon, CreditCardIcon } from "@/components/ui/icons";

/** 左カラム（検索+参加したスレッド+保存したスレッド+設定/プラン管理）。短いので通常フローのまま */
export function LeftRail() {
  return (
    <div className="space-y-4">
      <IssueSearchBox />
      <ParticipatedRail />

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
    </div>
  );
}
