"use client";

import Link from "next/link";
import { SITE } from "@/lib/constants";
import { CountUp } from "@/components/ui/count-up";
import { PushSubscribeButton } from "@/components/push/push-subscribe-button";

interface HomeIntroProps {
  participants: number;
}

/**
 * スレッド展開中は表示しない。以前はここで独自にuseSearchParams().get("issue")を読んで
 * 判定していたが、HomeFeed側の展開state（同期的に切り替わる）とrouter.replace()後の
 * searchParams反映（非同期）にタイムラグがあり、「展開直後の一瞬だけヒーローが見えたまま」
 * になる不具合の原因だった。表示可否はHomeFeedの展開stateと同じタイミングで切り替わるよう、
 * 呼び出し側（HomeFeed）が渡すbooleanで判定する
 */
export function HomeIntro({ participants }: HomeIntroProps) {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="animate-drift pointer-events-none absolute -left-16 -top-24 -z-10 h-64 w-64 rounded-full bg-accent/25 blur-[80px] dark:bg-accent/20"
      />
      <div
        aria-hidden="true"
        className="animate-drift-slow pointer-events-none absolute -top-10 left-40 -z-10 h-48 w-48 rounded-full bg-hot/15 blur-[70px]"
      />

      <div>
        <p className="bg-gradient-to-r from-ink via-accent to-hot bg-clip-text text-5xl font-extrabold tracking-tighter text-transparent sm:text-6xl lg:text-7xl">
          {SITE.displayName}
        </p>
        <h1 className="mt-2 text-xl font-semibold leading-snug tracking-tight text-ink-secondary sm:mt-3 text-balance">
          偏向報道でも、SNSのフィルターバブルでもない。第3のメディア。
        </h1>

        {participants > 0 && (
          <div className="mt-4 flex items-baseline gap-2.5 sm:mt-5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-pulse-hot rounded-full bg-hot" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-hot" />
            </span>
            <CountUp
              value={participants}
              className="bg-gradient-to-r from-ink to-accent bg-clip-text text-3xl font-extrabold tracking-tight text-transparent tabular-nums sm:text-4xl"
            />
            <span className="text-sm font-medium text-ink-secondary">人が今、議論に参加中</span>
          </div>
        )}

        <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-muted sm:mt-4">
          バズってる争点を中立に整理し、投票とスプリットで両側の意見が見える討論会場。
          ゴシップもニュースも、ここで議論できます。
        </p>
        <div className="mt-5 flex max-w-md flex-wrap items-center gap-3">
          <Link
            href="/about"
            className="flex flex-1 flex-col gap-1 rounded-2xl border border-border bg-surface-raised px-5 py-3.5 text-sm no-underline shadow-subtle transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow sm:flex-row sm:items-center sm:gap-3"
          >
            <span className="font-bold text-ink">{SITE.name}を知る</span>
            <span className="text-xs text-ink-muted">中立 · 両論 · アルゴなし →</span>
          </Link>
          <PushSubscribeButton />
        </div>
      </div>
    </div>
  );
}
