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
    "bg-accent text-white hover:bg-accent-hover border-transparent",
  secondary:
    "bg-surface-raised text-ink border-border hover:bg-surface-muted hover:border-border-strong",
  ghost:
    "bg-transparent text-ink-secondary border-transparent hover:bg-surface-muted hover:text-ink",
  "vote-for":
    "bg-for-muted text-for border-for/20 hover:border-for/40 hover:bg-for/10",
  "vote-against":
    "bg-against-muted text-against border-against/20 hover:border-against/40 hover:bg-against/10",
  "vote-neutral":
    "bg-neutral-muted text-neutral border-neutral/20 hover:border-neutral/40",
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
        "disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100",
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
