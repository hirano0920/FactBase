"use client";

import { cn } from "@/lib/utils";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function pageNumbers(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "ellipsis")[] = [1];
  if (current > 3) pages.push("ellipsis");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export function PaginationBar({ page, totalPages, onPageChange }: PaginationBarProps) {
  if (totalPages <= 1) return null;

  const nums = pageNumbers(page, totalPages);

  return (
    <nav aria-label="ページ送り" className="flex flex-wrap items-center justify-center gap-1 py-4">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={cn(
          "rounded-md border border-border px-3 py-1.5 text-sm font-medium transition",
          page > 1
            ? "text-ink-secondary hover:bg-surface-muted"
            : "cursor-not-allowed text-ink-faint",
        )}
      >
        前
      </button>

      {nums.map((n, i) =>
        n === "ellipsis" ? (
          <span key={`e-${i}`} className="px-1 text-sm text-ink-faint">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onPageChange(n)}
            aria-current={n === page ? "page" : undefined}
            className={cn(
              "min-w-[2.25rem] rounded-md border px-2 py-1.5 text-center text-sm font-medium",
              n === page
                ? "border-ink bg-ink text-surface"
                : "border-border text-ink-secondary hover:bg-surface-muted",
            )}
          >
            {n}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={cn(
          "rounded-md border border-border px-3 py-1.5 text-sm font-medium transition",
          page < totalPages
            ? "text-ink-secondary hover:bg-surface-muted"
            : "cursor-not-allowed text-ink-faint",
        )}
      >
        次
      </button>
    </nav>
  );
}
