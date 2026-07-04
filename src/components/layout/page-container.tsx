import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageContainerProps {
  children: ReactNode;
  width?: "content" | "wide";
  className?: string;
}

export function PageContainer({
  children,
  width = "wide",
  className,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-page py-8 sm:py-12",
        width === "content" ? "max-w-content" : "max-w-wide",
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SectionProps {
  children: ReactNode;
  className?: string;
}

export function Section({ children, className }: SectionProps) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-surface-raised p-6 shadow-card sm:p-8",
        className,
      )}
    >
      {children}
    </section>
  );
}

interface SectionTitleProps {
  children: ReactNode;
  className?: string;
}

export function SectionTitle({ children, className }: SectionTitleProps) {
  return (
    <h2
      className={cn(
        "mb-5 font-serif text-lg font-semibold text-ink sm:text-xl",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function AdSlot({
  label = "広告",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-[90px] items-center justify-center rounded-md border border-dashed border-border bg-surface-muted",
        className,
      )}
      role="complementary"
      aria-label={label}
    >
      <span className="text-xs tracking-wide text-ink-faint">{label}</span>
    </div>
  );
}
