import type { CategoryId, IssueStatus } from "@/lib/constants";
import { CATEGORIES, ISSUE_STATUSES } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "category" | "status" | "stance" | "pro";
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium tracking-wide",
        variant === "default" && "bg-surface-muted text-ink-muted",
        variant === "category" && "bg-accent/8 text-accent",
        variant === "status" && "bg-surface-muted text-ink-secondary",
        variant === "stance" && "bg-surface-muted text-ink-secondary",
        variant === "pro" && "border border-warm/25 bg-warm-muted text-warm-hover",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CategoryBadge({ category }: { category: CategoryId }) {
  const label = CATEGORIES.find((c) => c.id === category)?.label ?? category;
  return <Badge variant="category">{label}</Badge>;
}

export function StatusBadge({ status }: { status: IssueStatus }) {
  const label = ISSUE_STATUSES.find((s) => s.id === status)?.label ?? status;
  return <Badge variant="status">{label}</Badge>;
}
