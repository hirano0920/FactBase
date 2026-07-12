"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 「越境評価（bridging）」の説明用ミニ再現。実際のUIそのものではなく、
 * 「反対陣営からも支持されたコメントが上に来る」という仕組みを
 * 一目で伝えるための簡略図（スクロールで線が伸び、バッジが浮かぶ）。
 */
export function BridgingDemo() {
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

  return (
    <div ref={ref} className="relative w-full py-4">
      <div className="grid grid-cols-2 gap-6 sm:gap-10">
        <div className="rounded-2xl border border-for/25 bg-for-muted/50 p-4">
          <p className="text-[11px] font-extrabold text-for">賛成派のコメント</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
            「一次情報や複数媒体の報道が揃っている点は評価できる」
          </p>
        </div>
        <div className="rounded-2xl border border-against/25 bg-against-muted/50 p-4">
          <p className="text-[11px] font-extrabold text-against">反対派のコメント</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
            「報道と当事者の説明を踏まえると、一定の根拠があると感じる」
          </p>
        </div>
      </div>

      <div className="relative mx-auto mt-1 h-10 w-full max-w-[220px] sm:mt-2">
        <svg viewBox="0 0 200 50" className="h-full w-full overflow-visible" aria-hidden="true">
          <path
            d="M20 4 C20 30, 180 30, 180 4"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="220"
            style={{
              strokeDashoffset: visible ? 0 : 220,
              transition: "stroke-dashoffset 900ms ease-out 300ms",
            }}
          />
        </svg>
        <span
          className={cn(
            "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-accent px-3 py-1 text-[10.5px] font-extrabold text-white shadow-sm transition-all duration-500",
            visible ? "translate-y-[-50%] opacity-100" : "translate-y-[-30%] opacity-0",
          )}
          style={{ transitionDelay: "1000ms" }}
        >
          🔀 相手陣営の54%も支持
        </span>
      </div>
    </div>
  );
}
