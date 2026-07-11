"use client";

import { useEffect, useRef, useState } from "react";
import { Section, SectionTitle } from "@/components/layout/page-container";
import { BURST } from "@/lib/constants";
import type { IssueTimelineEntry } from "@/lib/data";

interface IssueTimelineLiveProps {
  issueId: string;
  initialEntries: IssueTimelineEntry[];
  /** 「要点」カードに同居させる省略表示。直近2件のみ表示し、残りは展開トグルにする */
  compact?: boolean;
}

const COMPACT_VISIBLE_COUNT = 1;

/**
 * 争点ページの更新タイムライン。Radar 公開・まとめ更新などを poll で反映。
 */
export function IssueTimelineLive({
  issueId,
  initialEntries,
  compact = false,
}: IssueTimelineLiveProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
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

  const visibleEntries = compact && !expanded ? entries.slice(0, COMPACT_VISIBLE_COUNT) : entries;
  const hiddenCount = entries.length - COMPACT_VISIBLE_COUNT;

  const list = (
    <ol className={compact ? "space-y-2" : "space-y-3"}>
      {visibleEntries.map((t) => (
        <li
          key={t.id}
          className={`flex gap-3 rounded-md transition-colors duration-700 ${compact ? "text-xs" : "text-sm"} ${
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
  );

  if (compact) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-ink-faint">更新</span>
        </div>
        {list}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 text-xs font-medium text-link underline-offset-2 hover:underline"
          >
            {expanded ? "閉じる" : `他${hiddenCount}件を見る`}
          </button>
        )}
      </div>
    );
  }

  return (
    <Section>
      <div className="mb-4 flex items-center gap-2">
        <SectionTitle className="mb-0">タイムライン</SectionTitle>
      </div>
      {list}
    </Section>
  );
}
