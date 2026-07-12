"use client";

import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "vote-for" | "vote-against" | "vote-neutral";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover border-transparent disabled:opacity-50",
  secondary:
    "bg-surface-raised text-ink border-border hover:bg-surface-muted hover:border-border-strong disabled:opacity-50",
  ghost:
    "bg-transparent text-ink-secondary border-transparent hover:bg-surface-muted hover:text-ink disabled:opacity-50",
  // vote-*は未ログイン時もdisabledで常時表示される主要CTA。disabled:opacity-50で薄めると
  // for/against/neutralの色差がほぼ消えてスプリットの主役性が死ぬため、無効時も彩度は落とさない
  "vote-for":
    "border-2 border-for/30 bg-for-muted text-for hover:border-for/60 hover:bg-for/15 disabled:border-for/20",
  "vote-against":
    "border-2 border-against/30 bg-against-muted text-against hover:border-against/60 hover:bg-against/15 disabled:border-against/20",
  "vote-neutral":
    "border-2 border-neutral/25 bg-neutral-muted text-neutral hover:border-neutral/50 disabled:border-neutral/15",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-3 text-base",
};

export function Button({
  variant = "secondary",
  size = "md",
  fullWidth,
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-medium",
        "transition-all duration-150 active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
        "focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "disabled:pointer-events-none disabled:active:scale-100",
        variantStyles[variant],
        sizeStyles[size],
        fullWidth && "w-full",
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}
