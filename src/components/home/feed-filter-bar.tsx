"use client";

import { CATEGORIES, type CategoryId, type IssueSortId } from "@/lib/constants";
import { cn } from "@/lib/utils";

const SORTS: { id: IssueSortId; label: string }[] = [
  { id: "created", label: "投稿順" },
  { id: "comments", label: "コメント多い順" },
  { id: "votes", label: "投票多い順" },
];

interface FeedFilterBarProps {
  activeCategory?: CategoryId;
  activeSort: IssueSortId;
  counts: Partial<Record<CategoryId, number>>;
  totalCount: number;
  onCategoryChange: (category?: CategoryId) => void;
  onSortChange: (sort: IssueSortId) => void;
}

export function FeedFilterBar({
  activeCategory,
  activeSort,
  counts,
  totalCount,
  onCategoryChange,
  onSortChange,
}: FeedFilterBarProps) {
  return (
    <div className="space-y-3">
      <div className="relative -mx-page sm:mx-0">
        <nav
          aria-label="カテゴリで絞り込み"
          className="flex gap-2 overflow-x-auto px-page pb-1 sm:flex-wrap sm:px-0"
        >
        <button
          type="button"
          onClick={() => onCategoryChange(undefined)}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-2.5 text-sm font-medium transition",
            !activeCategory
              ? "border-ink bg-ink text-surface"
              : "border-border text-ink-secondary hover:border-border-strong hover:bg-surface-muted",
          )}
        >
          すべて <span className="tabular-nums opacity-70">{totalCount}</span>
        </button>
        {CATEGORIES.filter((c) => (counts[c.id] ?? 0) > 0 || activeCategory === c.id).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onCategoryChange(c.id)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-2.5 text-sm font-medium transition",
              activeCategory === c.id
                ? "border-ink bg-ink text-surface"
                : "border-border text-ink-secondary hover:border-border-strong hover:bg-surface-muted",
            )}
          >
            {c.label} <span className="tabular-nums opacity-70">{counts[c.id] ?? 0}</span>
          </button>
        ))}
        </nav>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent sm:hidden"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-faint">並び替え</span>
        {SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSortChange(s.id)}
            className={cn(
              "rounded-full border px-3 py-2 text-xs font-semibold transition",
              activeSort === s.id
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-border text-ink-secondary hover:bg-surface-muted",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
