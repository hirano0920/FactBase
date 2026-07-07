"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BookmarkedIssue } from "@/lib/data";

type BookmarkState =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "user"; bookmarks: BookmarkedIssue[] };

/** サイドバーの保存スレッド。SSRをブロックせず、ログイン時だけ遅延取得する。 */
export function SidebarBookmarks() {
  const [state, setState] = useState<BookmarkState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/bookmarks");
        if (cancelled) return;
        if (res.status === 401) {
          setState({ kind: "guest" });
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { bookmarks: BookmarkedIssue[] };
        setState({ kind: "user", bookmarks: data.bookmarks });
      } catch {
        if (!cancelled) setState({ kind: "guest" });
      }
    };

    const timer = setTimeout(load, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (state.kind === "loading") {
    return <p className="text-xs text-ink-faint">読み込み中…</p>;
  }

  if (state.kind === "guest") {
    return (
      <p className="text-xs text-ink-faint">
        <Link href="/login" className="font-semibold text-link">
          ログイン
        </Link>
        すると気になるスレッドを保存できます
      </p>
    );
  }

  if (state.bookmarks.length === 0) {
    return <p className="text-xs text-ink-faint">保存したスレッドはまだありません</p>;
  }

  return (
    <ul className="space-y-2.5">
      {state.bookmarks.map((b) => (
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
  );
}
