"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface NotificationItem {
  issueId: string;
  slug: string;
  title: string;
  label: string;
  at: string;
}

/**
 * ヘッダーの続報通知ベル。ブックマーク/投票した争点にタイムライン更新（続報等）があれば
 * バッジで知らせ、クリックすると一覧をドロップダウン表示する。
 */
export function NotificationBell({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    // ページ本体の表示を優先し、通知は2秒後に取得（全ページで即DB叩きしない）
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/notifications");
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as { items: NotificationItem[] };
          if (!cancelled) setItems(data.items ?? []);
        } catch {
          // 通知は無くても議論自体には支障ないので静かに諦める
        }
      })();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isLoggedIn]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && items.length > 0) {
      try {
        await fetch("/api/notifications/seen", { method: "POST" });
      } catch {
        // 既読化に失敗しても表示自体には影響しない
      }
    }
  }, [open, items.length]);

  if (!isLoggedIn) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={`続報通知${items.length > 0 ? `（${items.length}件の未読）` : ""}`}
        className="relative rounded-full p-1.5 text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 18a2.5 2.5 0 0 0 5 0" />
        </svg>
        {items.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-hot px-1 text-[10px] font-bold leading-none text-white">
            {items.length > 9 ? "9+" : items.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden",
            "rounded-xl border border-border bg-surface-raised shadow-lg",
          )}
        >
          <p className="border-b border-border px-4 py-2.5 text-xs font-bold text-ink-faint">続報通知</p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">
              新しい続報はありません
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((item) => (
                <li key={item.issueId} className="border-b border-border last:border-b-0">
                  <Link
                    href={`/issues/${item.slug}`}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 no-underline transition-colors hover:bg-surface-muted"
                  >
                    <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-faint">{item.label}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
