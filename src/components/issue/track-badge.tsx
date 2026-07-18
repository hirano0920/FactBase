import type { Issue } from "@/types";

/**
 * TwoSides Debate / News のトラック表示。
 * カード・争点ヘッダーでカテゴリ横に出す最小バッジ。
 */
export function TrackBadge({ track }: { track: Issue["track"] }) {
  const isNews = track === "news";
  return (
    <span
      className={
        isNews
          ? "rounded-md bg-ink/8 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-ink-secondary"
          : "rounded-md bg-accent/12 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-accent"
      }
    >
      {isNews ? "News" : "Debate"}
    </span>
  );
}
