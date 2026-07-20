"use client";

import { cn } from "@/lib/utils";
import { useDeck } from "@/components/home/card-deck/deck-context";

/**
 * PCカードデッキモードの左レール。モバイルのストーリーズ横スクロールに相当する
 * 「今日のトップ」縦リスト。クリック・番号キー(1〜9)でデッキ側のカードに直接ジャンプできる。
 */
export function DeckTodayRail() {
  const { issues, index, seenIds, jumpTo } = useDeck();

  return (
    <div>
      <p className="mb-2.5 ml-0.5 text-[11px] font-extrabold tracking-wide text-ink-faint">
        📰 今日のトップ
      </p>
      <ul className="space-y-0.5">
        {issues.map((issue, i) => {
          const isCurrent = i === index;
          const isSeen = seenIds.has(issue.id);
          return (
            <li key={issue.id}>
              <button
                type="button"
                onClick={() => jumpTo(i)}
                className={cn(
                  "grid w-full grid-cols-[16px_1fr] items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                  isCurrent ? "bg-accent-soft" : "hover:bg-surface-muted",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 text-[9px] font-extrabold tabular-nums",
                    isSeen ? "text-ink-faint" : "text-accent",
                  )}
                  aria-hidden="true"
                >
                  {isSeen ? "✓" : i + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      "block text-[13px] font-semibold leading-snug",
                      isSeen ? "text-ink-faint" : "text-ink",
                    )}
                  >
                    {issue.shareTitle || issue.title}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-[11px] leading-relaxed text-ink-faint">
        クリックでその記事にジャンプ・<kbd className="rounded border border-border-strong bg-surface-raised px-1 py-0.5 text-[10px] font-bold">1</kbd>〜<kbd className="rounded border border-border-strong bg-surface-raised px-1 py-0.5 text-[10px] font-bold">9</kbd>で直接ジャンプ
      </p>
    </div>
  );
}
