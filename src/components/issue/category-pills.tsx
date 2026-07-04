import Link from "next/link";
import { CATEGORIES, type CategoryId } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface CategoryPillsProps {
  basePath: string;
  activeCategory?: CategoryId;
  counts: Partial<Record<CategoryId, number>>;
  totalCount: number;
}

/** みんなの国会の「カテゴリから見る」を参考にした件数付きフィルタピル。横スクロール対応。 */
export function CategoryPills({ basePath, activeCategory, counts, totalCount }: CategoryPillsProps) {
  return (
    <nav
      aria-label="カテゴリで絞り込み"
      className="-mx-page flex gap-2 overflow-x-auto px-page pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
    >
      <Link
        href={basePath}
        className={cn(
          "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium no-underline transition-colors",
          !activeCategory
            ? "border-ink bg-ink text-surface"
            : "border-border text-ink-secondary hover:border-border-strong hover:bg-surface-muted",
        )}
      >
        すべて <span className="tabular-nums opacity-70">{totalCount}</span>
      </Link>
      {CATEGORIES.map((c) => (
        <Link
          key={c.id}
          href={`${basePath}?category=${c.id}`}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium no-underline transition-colors",
            activeCategory === c.id
              ? "border-ink bg-ink text-surface"
              : "border-border text-ink-secondary hover:border-border-strong hover:bg-surface-muted",
          )}
        >
          {c.label} <span className="tabular-nums opacity-70">{counts[c.id] ?? 0}</span>
        </Link>
      ))}
    </nav>
  );
}
