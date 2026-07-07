"use client";

import { useEffect, useRef, useState } from "react";
import { LiveBadge } from "@/components/ui/live-badge";
import { Section, SectionTitle } from "@/components/layout/page-container";
import { BURST } from "@/lib/constants";
import type { IssueTimelineEntry } from "@/lib/data";

interface IssueTimelineLiveProps {
  issueId: string;
  initialEntries: IssueTimelineEntry[];
  /** "reported"（未確認の進行中速報）のときだけ🔴LIVEを出す。"official"（公式発表確定済み）はタイムラインはあってもLIVEではない */
  confirmation: "official" | "reported" | null;
}

/**
 * 争点ページの LIVE タイムライン。Radar 公開・まとめ更新などを poll で反映。
 */
export function IssueTimelineLive({ issueId, initialEntries, confirmation }: IssueTimelineLiveProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const knownIds = useRef(new Set(initialEntries.map((e) => e.id)));

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/issues/${encodeURIComponent(issueId)}/timeline`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { entries: IssueTimelineEntry[] };
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
        // ignore
      }
    };

    const timer = setInterval(poll, BURST.timelinePollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [issueId]);

  if (entries.length === 0) return null;

  return (
    <Section>
      <div className="mb-4 flex items-center gap-2">
        <SectionTitle className="mb-0">タイムライン</SectionTitle>
        {confirmation === "reported" && <LiveBadge />}
      </div>
      <ol className="space-y-3">
        {entries.map((t) => (
          <li
            key={t.id}
            className={`flex gap-3 rounded-md text-sm transition-colors duration-700 ${
              highlightIds.has(t.id) ? "bg-hot-muted px-2 py-1 -mx-2" : ""
            }`}
          >
            <time className="shrink-0 tabular-nums text-ink-faint">
              {new Date(t.at).toLocaleString("ja-JP", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <span className="text-ink-secondary">
              {t.label}
              {t.sourceUrl && (
                <a
                  href={t.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="ml-1 text-link underline"
                >
                  出典
                </a>
              )}
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
