"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Share } from "lucide-react";
import type { VoteLabels } from "@/types";
import type { VoteSwing } from "@/lib/vote-swing";
import { cn } from "@/lib/utils";
import { SITE } from "@/lib/constants";

interface SwingIndicatorProps {
  slug: string;
  initialSwing: VoteSwing | null;
  labels?: VoteLabels | null;
  /** Xシェア文言用の争点タイトル。渡すと「この動きをシェア」ボタンが出る */
  shareTitle?: string;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * 「対立の結果でなく説得の過程を商品化する」コアメカニクス。
 * 中立層(undecided)の説得合戦がリアルタイムで動いているのを見せることで、
 * 陣営同士の攻撃ではなく中立層への説得を可視化する。
 * 母数が少ない争点はノイズが支配的になるため、swing=nullなら何も表示しない。
 */
export function SwingIndicator({ slug, initialSwing, labels, shareTitle }: SwingIndicatorProps) {
  const [swing, setSwing] = useState<VoteSwing | null>(initialSwing);

  useEffect(() => {
    setSwing(initialSwing);
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/issues/${encodeURIComponent(slug)}/vote-swing`);
        if (!res.ok) return;
        const data = (await res.json()) as { swing: VoteSwing | null };
        if (!cancelled) setSwing(data.swing);
      } catch {
        // 次回ポーリングで再試行
      }
    };
    const interval = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [slug, initialSwing]);

  if (!swing) return null;

  const forLabel = labels?.for ?? "賛成側";
  const againstLabel = labels?.against ?? "反対側";
  const leader: "for" | "against" | null =
    swing.deltaPoints.for > swing.deltaPoints.against
      ? "for"
      : swing.deltaPoints.against > swing.deltaPoints.for
        ? "against"
        : null;

  if (!leader) return null;

  const leaderLabel = leader === "for" ? forLabel : againstLabel;
  const delta = Math.abs(swing.deltaPoints[leader]);
  if (delta < 0.5) return null;

  const tone = leader === "for" ? "for" : "against";
  const swingText = `直近${swing.hoursAgo}時間で中立層の${delta}ptが${leaderLabel}へ`;

  // 「揺れている瞬間」そのものを切り出してXに投稿する導線（戦略: スイングカード拡散ループ）。
  // OG画像側（opengraph-image.tsx）も同じスイングを描画するため、リンクカードがスイングカードになる
  const shareUrl = (() => {
    if (!shareTitle) return null;
    // window.location由来だとSSRとハイドレーションで結果が変わりmismatchするため、固定のSITE.urlを使う
    const pageUrl = `${SITE.url}/issues/${slug}`;
    const text = `「${shareTitle}」${swingText}動いています`;
    return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`;
  })();

  return (
    <div className="mx-auto mt-3 flex w-fit flex-col items-center gap-1.5">
      <div
        role="status"
        className={cn(
          "flex w-fit items-center gap-2 rounded-full border px-3.5 py-1.5",
          "animate-fade-slide-up shadow-subtle",
          tone === "for"
            ? "border-for/25 bg-for-muted text-for"
            : "border-against/25 bg-against-muted text-against",
        )}
      >
        <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              tone === "for" ? "bg-for" : "bg-against",
            )}
          />
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", tone === "for" ? "bg-for" : "bg-against")} />
        </span>
        <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={2.5} />
        <span className="text-xs font-bold tabular-nums">{swingText}</span>
      </div>
      {shareUrl && (
        <a
          href={shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] font-semibold text-ink-faint no-underline transition-colors hover:text-ink"
        >
          <Share className="h-3 w-3" aria-hidden="true" />
          この動きをXでシェア
        </a>
      )}
    </div>
  );
}
