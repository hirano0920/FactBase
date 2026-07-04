import Link from "next/link";
import { CATEGORIES } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";
import type { RankingItem } from "@/types";

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

interface HotThreadListProps {
  title: string;
  items: RankingItem[];
  /** trueなら1位・2位…の順位番号を大きく出す（週間ランキング用） */
  showRank?: boolean;
  emptyMessage?: string;
}

const RANK_STYLES = [
  "text-hot", // 1位だけ目立つ色
  "text-ink-faint",
  "text-ink-faint",
] as const;

/**
 * Xのトレンド欄を参考にした、争点の目立たせ表示。
 * カテゴリ・投票数・累計コメント数を1行で見せ、スキャンしやすくする。
 */
export function HotThreadList({ title, items, showRank = false, emptyMessage }: HotThreadListProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised">
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="animate-flicker text-sm leading-none">🔥</span>
        <p className="text-[15px] font-extrabold tracking-tight text-ink">{title}</p>
      </div>
      {items.length > 0 ? (
        <ul className="divide-y divide-border">
          {items.map((item, i) => (
            <li key={item.issue.id}>
              <Link
                href={`/issues/${item.issue.slug}`}
                className="flex items-start gap-3 px-4 py-3 no-underline transition-colors hover:bg-surface-muted"
              >
                {showRank && (
                  <span
                    className={`w-5 shrink-0 text-lg font-extrabold tabular-nums ${RANK_STYLES[Math.min(i, 2)]}`}
                  >
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-ink-faint">
                    {CATEGORY_LABELS[item.issue.category]}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm font-bold leading-snug text-ink">
                    {item.issue.title}
                  </p>
                  <p className="mt-1 text-xs font-semibold tabular-nums text-ink-muted">
                    {formatNumber(item.voteTally.totalVoters)}人投票 · 累計
                    {formatNumber(item.commentCount)}コメント
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-xs text-ink-faint">{emptyMessage ?? "まだデータがありません"}</p>
      )}
    </div>
  );
}
