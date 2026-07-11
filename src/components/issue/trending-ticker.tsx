import Link from "next/link";
import { formatNumber } from "@/lib/utils";
import { CATEGORIES } from "@/lib/constants";
import type { RankingItem } from "@/types";

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

const TINTS = [
  "bg-hot-muted border-hot-border",
  "bg-accent/5 border-accent/20",
  "bg-warm-muted border-warm/25",
] as const;

/**
 * ホーム上部の横スクロール「いま燃えてる争点」チップ列。1位だけ炎アイコン付き。
 * ホームでは投票結果（賛成/反対の内訳）を見せず、読んでから一票を投じてもらう設計。
 */
export function TrendingTicker({ items }: { items: RankingItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="-mx-page flex gap-2.5 overflow-x-auto px-page pb-1 sm:mx-0 sm:px-0">
      {items.map((item, i) => (
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
                {formatNumber(item.voteTally.totalVoters)}人投票
              </span>
            )}
            {i !== 0 && (
              <span className="text-xs font-bold text-ink-faint">
                {formatNumber(item.voteTally.totalVoters)}人投票
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-sm font-bold leading-snug text-ink">
            {item.issue.shareTitle || item.issue.title}
          </p>
        </Link>
      ))}
    </div>
  );
}
