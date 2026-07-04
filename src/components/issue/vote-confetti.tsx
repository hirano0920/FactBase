"use client";

import { useMemo } from "react";

const PIECES = ["🎉", "✨", "🎊", "⭐️"] as const;

interface VoteConfettiProps {
  /** 変わるたびに紙吹雪を再生する（親がkeyとして使う想定でも良いが、内部でも使えるように） */
  burstId: number;
}

/** 投票確定の瞬間に散らす紙吹雪。1回限りのCSSアニメーションで自然に消える。 */
export function VoteConfetti({ burstId }: VoteConfettiProps) {
  const particles = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.5;
      const distance = 60 + Math.random() * 50;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance - 20;
      const rot = Math.random() * 360 - 180;
      return {
        id: i,
        emoji: PIECES[i % PIECES.length],
        style: {
          ["--dx" as string]: `${dx}px`,
          ["--dy" as string]: `${dy}px`,
          ["--rot" as string]: `${rot}deg`,
          animationDelay: `${Math.random() * 80}ms`,
          fontSize: `${14 + Math.random() * 10}px`,
        },
      };
    });
    // burstIdが変わるたびに新しい乱数配置で再生し直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstId]);

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible"
      aria-hidden="true"
    >
      {particles.map((p) => (
        <span key={`${burstId}-${p.id}`} className="absolute animate-confetti" style={p.style}>
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
