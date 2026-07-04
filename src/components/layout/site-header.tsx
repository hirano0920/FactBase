import Link from "next/link";
import { auth, signOut } from "@/auth";
import { SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { isAdminEmail } from "@/lib/admin-emails";

const NAV = [
  { href: "/issues", label: "スレ一覧", emoji: "📁" },
  { href: "/ranking", label: "Hotなスレ", emoji: "🔥" },
  { href: "/ranking?period=week", label: "Hotな投票", emoji: "📈" },
  { href: "/pricing", label: "Plus/Proプラン", emoji: "🔏" },
] as const;

const PLAN_LABELS = {
  FREE: null,
  COMMENT: "コメント会員",
  FACTCHECK: "FC会員",
} as const;

export async function SiteHeader() {
  const session = await auth();
  const user = session?.user ?? null;
  const planLabel = user ? PLAN_LABELS[user.plan] : null;
  const showAdmin = user && isAdminEmail(user.email);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-wide items-center justify-between px-page">
        <Link
          href="/"
          className="text-lg font-extrabold tracking-tighter text-ink no-underline hover:text-accent"
        >
          {SITE.name}
        </Link>

        <nav className="hidden items-center gap-6 sm:flex" aria-label="メイン">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-1.5 text-sm font-semibold text-ink-secondary no-underline transition-colors hover:text-ink"
            >
              <span aria-hidden="true">{item.emoji}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {user ? (
            <>
              {planLabel && (
                <span className="hidden rounded-full border border-accent/25 bg-accent/5 px-2.5 py-0.5 text-xs font-medium text-accent sm:inline">
                  {planLabel}
                </span>
              )}
              {showAdmin && (
                <Link
                  href="/admin"
                  className="hidden rounded-md border border-amber-400/50 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 no-underline hover:bg-amber-100 sm:inline"
                >
                  管理
                </Link>
              )}
              <Link
                href="/account"
                className="hidden max-w-[10rem] truncate text-sm text-ink-secondary no-underline hover:text-ink sm:inline"
              >
                {user.name ?? "ログイン中"}
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
                "rounded-full bg-ink px-4 py-1.5",
                "text-sm font-semibold text-surface no-underline",
                "transition-transform hover:scale-[1.03] active:scale-[0.97]",
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
