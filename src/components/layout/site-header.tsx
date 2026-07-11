import Link from "next/link";
import { auth, signOut } from "@/auth";
import { SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationBell } from "@/components/layout/notification-bell";
import { FlameIcon, LockIcon, TrendingUpIcon } from "@/components/ui/icons";

const DESKTOP_NAV = [
  { href: "/ranking", label: "Hotなスレ", Icon: FlameIcon },
  { href: "/ranking/votes", label: "Hotな投票", Icon: TrendingUpIcon },
  { href: "/pricing", label: "Plus/Pro", Icon: LockIcon },
] as const;

const PLAN_LABELS = {
  FREE: null,
  COMMENT: "Plus",
  FACTCHECK: "Pro",
} as const;

export async function SiteHeader() {
  const session = await auth();
  const user = session?.user ?? null;
  const planLabel = user ? PLAN_LABELS[user.plan] : null;

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur-md">
      {/* サイドバー列が消える lg 未満はコンパクトヘッダー */}
      <div className="mx-auto flex h-12 max-w-wide items-center gap-2 px-3 lg:hidden">
        <Link
          href="/"
          className="shrink-0 text-base font-extrabold tracking-tighter text-ink no-underline"
        >
          {SITE.displayName}
        </Link>

        <div className="flex-1" />

        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          {user ? (
            <>
              <NotificationBell isLoggedIn />
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="whitespace-nowrap px-1 text-xs font-bold text-ink-secondary hover:text-ink"
                >
                  退出
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="whitespace-nowrap rounded-full bg-gradient-to-r from-accent to-accent-hover px-3 py-1 text-xs font-bold text-white no-underline"
            >
              ログイン
            </Link>
          )}
        </div>
      </div>

      {/* ワイド画面のみフルヘッダー（nav を画面中央に固定する 3 列グリッド） */}
      <div className="mx-auto hidden h-14 max-w-wide grid-cols-[1fr_auto_1fr] items-center gap-4 px-page lg:grid">
        <Link
          href="/"
          className="justify-self-start text-lg font-extrabold tracking-tighter text-ink no-underline hover:text-accent"
        >
          {SITE.displayName}
        </Link>

        <nav className="flex items-center justify-center gap-6" aria-label="メイン">
          {DESKTOP_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-1.5 text-sm font-semibold text-ink-secondary no-underline transition-colors hover:text-ink"
            >
              <item.Icon style={{ width: 16, height: 16 }} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center justify-self-end gap-2">
          <ThemeToggle />
          {user && <NotificationBell isLoggedIn />}
          {user ? (
            <>
              {planLabel && (
                <span className="rounded-full border border-accent/25 bg-accent/5 px-2.5 py-0.5 text-xs font-medium text-accent">
                  {planLabel}
                </span>
              )}
              <Link
                href="/account"
                className="max-w-[10rem] truncate text-sm text-ink-secondary no-underline hover:text-ink"
              >
                {user.name ?? "アカウント"}
              </Link>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className={cn(
                    "rounded-md border border-border px-3 py-1.5",
                    "text-sm text-ink-secondary",
                    "transition-colors hover:border-border-strong hover:bg-surface-muted hover:text-ink",
                  )}
                >
                  ログアウト
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className={cn(
                "rounded-full bg-gradient-to-r from-accent to-accent-hover px-4 py-1.5",
                "text-sm font-semibold text-white no-underline",
                "shadow-subtle transition-transform hover:scale-[1.03] hover:shadow-glow active:scale-[0.97]",
              )}
            >
              ログイン
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
