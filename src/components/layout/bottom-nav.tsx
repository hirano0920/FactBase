"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  {
    href: "/",
    label: "ホーム",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5"
      />
    ),
  },
  {
    href: "/?live=1#live-feed",
    label: "LIVE",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3a6 6 0 0 0-9 8.5M12 21a6 6 0 0 0 9-8.5M9.5 9.5a3 3 0 1 1 5 0"
      />
    ),
  },
  {
    href: "/ranking",
    label: "注目",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 20V10m6 10V4m6 16v-7m4 7H2"
      />
    ),
  },
  {
    href: "/account",
    label: "アカウント",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"
      />
    ),
  },
] as const;

/** モバイル専用の下部タブバー。 */
export function BottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isLive = searchParams.get("live") === "1";

  return (
    <nav
      aria-label="モバイルナビゲーション"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface/95 backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-4">
        {TABS.map((tab) => {
          const active =
            tab.href === "/"
              ? pathname === "/" && !isLive
              : tab.label === "LIVE"
                ? pathname === "/" && isLive
                : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] no-underline transition-colors",
                active ? "text-accent font-medium" : "text-ink-faint hover:text-ink-secondary",
              )}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={active ? 2.2 : 1.8}
                className="h-6 w-6"
                aria-hidden
              >
                {tab.icon}
              </svg>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
