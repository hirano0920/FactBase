"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LiveBadge } from "@/components/ui/live-badge";
import { BURST } from "@/lib/constants";
import type { GlobalTimelineEntry } from "@/lib/data";

interface LiveTimelineFeedProps {
  initialEntries: GlobalTimelineEntry[];
}

/**
 * サイドバー用 LIVE タイムライン。30秒ごとに poll し新着を先頭に追加表示。
 */
export function LiveTimelineFeed({ initialEntries }: LiveTimelineFeedProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const knownIds = useRef(new Set(initialEntries.map((e) => e.id)));

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/timeline/live");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { entries: GlobalTimelineEntry[] };
        const fresh = data.entries.filter((e) => !knownIds.current.has(e.id));
        for (const e of data.entries) knownIds.current.add(e.id);
        if (fresh.length > 0) {
          setHighlightIds((prev) => new Set([...prev, ...fresh.map((e) => e.id)]));
          setTimeout(() => {
            setHighlightIds((prev) => {
              const next = new Set(prev);
              for (const e of fresh) next.delete(e.id);
              return next;
            });
          }, 4000);
        }
        setEntries(data.entries);
      } catch {
        // 次回 poll で再試行
      }
    };

    const timer = setInterval(poll, BURST.timelinePollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-hot-border bg-hot-muted/40">
      <div className="flex items-center gap-2 border-b border-hot-border/60 px-4 py-2.5">
        <LiveBadge />
        <span className="text-xs font-bold text-ink-muted">更新タイムライン</span>
      </div>
      <ul className="max-h-52 divide-y divide-border/60 overflow-y-auto">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={`px-4 py-2.5 transition-colors duration-700 ${
              highlightIds.has(entry.id) ? "bg-hot-muted" : ""
            }`}
          >
            <time className="block text-[10px] tabular-nums text-ink-faint">
              {new Date(entry.at).toLocaleString("ja-JP", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <Link
              href={`/issues/${entry.issueSlug}`}
              className="mt-0.5 block truncate text-xs font-bold text-ink no-underline hover:text-accent"
            >
              {entry.issueTitle}
            </Link>
            <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-ink-secondary">
              {entry.label}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
