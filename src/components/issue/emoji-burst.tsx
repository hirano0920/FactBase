"use client";

/** ボタン押下時に絵文字が浮かび上がって消える単発エフェクト。keyで再マウントさせて再生する。 */
export function EmojiBurst({ emoji }: { emoji: string }) {
  return (
    <span
      className="animate-emoji-float pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 text-lg"
      aria-hidden="true"
    >
      {emoji}
    </span>
  );
}
