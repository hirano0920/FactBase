import Link from "next/link";
import { HotThreadList } from "@/components/issue/hot-thread-list";
import { LiveTimelineFeed } from "@/components/issue/live-timeline-feed";
import { LiveBadge } from "@/components/ui/live-badge";
import { BookmarkIcon, SettingsIcon, CreditCardIcon } from "@/components/ui/icons";
import type { BookmarkedIssue, GlobalTimelineEntry } from "@/lib/data";
import type { RankingItem } from "@/types";
import type { Plan } from "@prisma/client";

interface AppSidebarBodyProps {
  hotNow: RankingItem[];
  weekly: RankingItem[];
  liveTimeline: GlobalTimelineEntry[];
  bookmarks: BookmarkedIssue[];
  userId: string | null;
  plan: Plan;
}

export function AppSidebarBody({
  hotNow,
  weekly,
  liveTimeline,
  bookmarks,
  userId,
  plan,
}: AppSidebarBodyProps) {
  const hasHotThreads = hotNow.length > 0 || weekly.length > 0;

  return (
    <aside className="space-y-4">
      {plan === "FREE" && (
        <div className="rounded-xl border border-warm/25 bg-warm-muted p-4">
          <p className="mb-1 text-xs font-extrabold text-warm-hover">FactBase Plus</p>
          <p className="mb-3 text-xs leading-relaxed text-ink-secondary">
            ワンタップFCと広告なし体験を。3日間無料で試せます。
          </p>
          <Link
            href="/pricing"
            className="block rounded-full bg-ink px-3 py-2 text-center text-xs font-bold text-surface no-underline transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            はじめる
          </Link>
        </div>
      )}

      {hasHotThreads && (
        <div className="flex items-center px-1">
          <LiveBadge />
        </div>
      )}

      <LiveTimelineFeed initialEntries={liveTimeline} />

      <HotThreadList title="今Hotなスレッド" items={hotNow} emptyMessage="まだ話題のスレッドがありません" />

      <HotThreadList
        title="今週Hotなスレッド"
        items={weekly}
        showRank
        emptyMessage="今週のスレッドはまだありません"
      />

      <div className="rounded-xl border border-border bg-surface-raised p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <BookmarkIcon style={{ width: 14, height: 14 }} className="text-ink-secondary" />
          <p className="text-xs font-extrabold text-ink">保存したスレッド</p>
        </div>
        {!userId ? (
          <p className="text-xs text-ink-faint">
            <Link href="/login" className="font-semibold text-link">
              ログイン
            </Link>
            すると気になる争点を保存できます
          </p>
        ) : bookmarks.length > 0 ? (
          <ul className="space-y-2.5">
            {bookmarks.map((b) => (
              <li key={b.slug}>
                <Link
                  href={`/issues/${b.slug}`}
                  className="block truncate text-xs text-ink-secondary no-underline hover:text-accent"
                >
                  {b.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-faint">保存したスレッドはまだありません</p>
        )}
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
          About
        </Link>
        {" · "}
        <Link href="/transparency" className="hover:text-ink-secondary">
          透明性
        </Link>
        {" · "}
        <Link href="/pricing" className="hover:text-ink-secondary">
          料金
        </Link>
        <br />© FactBase Tokyo
      </p>
    </aside>
  );
}
