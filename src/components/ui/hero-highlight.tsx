"use client";
import { cn } from "@/lib/utils";
import { useMotionValue, motion, useMotionTemplate } from "framer-motion";
import React from "react";

/**
 * マウス追従のドットパターン・スポットライト演出（aceternity-ui の HeroHighlight を移植）。
 * 元コンポーネントはneutral-300/neutral-800・indigo-500をハードコードしていたが、
 * サイト自体がbg-surface/text-ink等のCSS変数で自動的にライト/ダークを切り替えるため、
 * ここでも同じトークン（border色・accent色）を使い、常にサイトの配色と一致させる。
 */
export const HeroHighlight = ({
  children,
  className,
  containerClassName,
  backdrop,
}: {
  children: React.ReactNode;
  className?: string;
  containerClassName?: string;
  /** ドットパターンとテキストの間に敷く任意の背景レイヤー（実画面のモック等）。フェード処理は呼び出し側で行う */
  backdrop?: React.ReactNode;
}) => {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  function handleMouseMove({
    currentTarget,
    clientX,
    clientY,
  }: React.MouseEvent<HTMLDivElement>) {
    if (!currentTarget) return;
    const { left, top } = currentTarget.getBoundingClientRect();

    mouseX.set(clientX - left);
    mouseY.set(clientY - top);
  }

  const dotPattern = (color: string) => ({
    backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1px)`,
    backgroundSize: "16px 16px",
  });

  return (
    <div
      className={cn(
        "group relative flex w-full items-center justify-center bg-surface",
        containerClassName,
      )}
      onMouseMove={handleMouseMove}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={dotPattern("var(--color-border-strong)")}
      />
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100"
        style={{
          ...dotPattern("var(--color-accent)"),
          WebkitMaskImage: useMotionTemplate`
            radial-gradient(
              200px circle at ${mouseX}px ${mouseY}px,
              black 0%,
              transparent 100%
            )
          `,
          maskImage: useMotionTemplate`
            radial-gradient(
              200px circle at ${mouseX}px ${mouseY}px,
              black 0%,
              transparent 100%
            )
          `,
        }}
      />

      {backdrop}

      <div className={cn("relative z-20", className)}>{children}</div>
    </div>
  );
};

export const Highlight = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <motion.span
      initial={{
        backgroundSize: "0% 100%",
      }}
      animate={{
        backgroundSize: "100% 100%",
      }}
      transition={{
        duration: 2,
        ease: "linear",
        delay: 0.5,
      }}
      style={{
        backgroundRepeat: "no-repeat",
        backgroundPosition: "left center",
        display: "inline",
      }}
      className={cn(
        "relative inline-block rounded-lg bg-gradient-to-r from-accent-soft to-accent-soft px-1 pb-1",
        className,
      )}
    >
      {children}
    </motion.span>
  );
};
