"use client";

import { motion, type Transition } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * カード枠に沿って光の粒が周回する演出（おすすめプランの視認性を上げる）。
 * 元コンポーネントは`bg-zinc-500`+白黒の固定boxShadowだったが、サイトのアクセントカラーに合わせる。
 */
type BorderTrailProps = {
  className?: string;
  size?: number;
  transition?: Transition;
  delay?: number;
  onAnimationComplete?: () => void;
  style?: React.CSSProperties;
};

export function BorderTrail({ className, size = 60, transition, delay, onAnimationComplete, style }: BorderTrailProps) {
  const BASE_TRANSITION: Transition = {
    repeat: Infinity,
    duration: 5,
    ease: "linear",
  };

  return (
    <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]">
      <motion.div
        className={cn("absolute aspect-square bg-accent", className)}
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          ...style,
        }}
        animate={{
          offsetDistance: ["0%", "100%"],
        }}
        transition={{
          ...(transition ?? BASE_TRANSITION),
          delay,
        }}
        onAnimationComplete={onAnimationComplete}
      />
    </div>
  );
}
