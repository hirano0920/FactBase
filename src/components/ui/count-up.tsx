"use client";

import { useEffect, useRef, useState } from "react";
import { formatNumber } from "@/lib/utils";

interface CountUpProps {
  value: number;
  className?: string;
  /** アニメーション時間(ms) */
  duration?: number;
  /** 表示フォーマット。既定はカンマ区切り数値 */
  format?: (n: number) => string;
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * 数値が変わるたびに、直前の表示値から新しい値へなめらかにカウントする。
 * 初回マウント時は0からカウントアップ（「動いてる」第一印象用）。
 * 2回目以降（ライブ投票更新など）は前回値からの差分だけをアニメーションする。
 */
export function CountUp({ value, className, duration = 600, format = formatNumber }: CountUpProps) {
  const [display, setDisplay] = useState(0);
  const prevValueRef = useRef(0);
  const hasMountedRef = useRef(false);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const from = hasMountedRef.current ? prevValueRef.current : 0;
    hasMountedRef.current = true;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || from === value) {
      setDisplay(value);
      prevValueRef.current = value;
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setDisplay(Math.round(from + (value - from) * easeOutExpo(t)));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        prevValueRef.current = value;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return <span className={className}>{format(display)}</span>;
}
