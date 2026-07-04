import Link from "next/link";
import { formatPercent } from "@/lib/utils";
import { CATEGORIES } from "@/lib/constants";
import type { RankingItem } from "@/types";

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

const TINTS = [
  "bg-hot-muted border-hot-border",
  "bg-accent/5 border-accent/20",
  "bg-warm-muted border-warm/25",
] as const;

/** ホーム上部の横スクロール「いま燃えてる争点」チップ列。1位だけ炎アイコン付き。 */
export function TrendingTicker({ items }: { items: RankingItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="-mx-page flex gap-2.5 overflow-x-auto px-page pb-1 sm:mx-0 sm:px-0">
      {items.map((item, i) => {
        const leading =
          item.voteTally.percents.for >= item.voteTally.percents.against
            ? { label: "賛成", percent: item.voteTally.percents.for }
            : { label: "反対", percent: item.voteTally.percents.against };
        return (
          <Link
            key={item.issue.id}
            href={`/issues/${item.issue.slug}`}
            className={`min-w-[180px] shrink-0 rounded-xl border p-3 no-underline transition-transform hover:scale-[1.02] ${TINTS[i % TINTS.length]}`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-ink-muted">
                {CATEGORY_LABELS[item.issue.category]}
              </span>
              {i === 0 && (
                <span className="flex items-center gap-1 text-xs font-extrabold text-hot">
                  <span className="animate-flicker leading-none">🔥</span>
                  {leading.label} {formatPercent(leading.percent)}
                </span>
              )}
              {i !== 0 && (
                <span className="text-xs font-bold text-ink-faint">
                  {leading.label} {formatPercent(leading.percent)}
                </span>
              )}
            </div>
            <p className="line-clamp-2 text-sm font-bold leading-snug text-ink">
              {item.issue.title}
            </p>
          </Link>
        );
      })}
    </div>
  );
}
