"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const BUCKETS = [
  { label: "強く反対", pct: 2 },
  { label: "やや反対", pct: 9 },
  { label: "中立", pct: 78 },
  { label: "やや賛成", pct: 9 },
  { label: "強く賛成", pct: 2 },
] as const;

/**
 * 「沈黙の多数派」ヒートマップの説明用ミニ再現。実データではなく、
 * 「騒いでいるのは両端の細い尻尾、多数派は真ん中に固まる」という主張を
 * 視覚的に一発で伝えるための例示グラフ（スクロールで棒が伸びる）。
 */
export function DistributionBars() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(...BUCKETS.map((b) => b.pct));

  return (
    <div ref={ref} className="w-full">
      <div className="flex h-32 items-end gap-2 sm:h-40 sm:gap-3">
        {BUCKETS.map((b, i) => (
          <div key={b.label} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-[11px] font-bold tabular-nums text-ink-faint">{visible ? `${b.pct}%` : ""}</span>
            <div className="flex h-full w-full items-end overflow-hidden rounded-t-md bg-surface-muted">
              <div
                className={cn(
                  "w-full rounded-t-md transition-[height] duration-[900ms] ease-out",
                  b.pct === max ? "bg-accent" : "bg-accent/35",
                )}
                style={{
                  height: visible ? `${(b.pct / max) * 100}%` : "0%",
                  transitionDelay: `${i * 90}ms`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2 sm:gap-3">
        {BUCKETS.map((b) => (
          <span key={b.label} className="flex-1 text-center text-[10.5px] leading-tight text-ink-faint">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
