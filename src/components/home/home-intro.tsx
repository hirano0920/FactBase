"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SITE } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";

interface HomeIntroProps {
  participants: number;
}

/** ?issue= 指定時はヒーローを隠す（searchParams をサーバーで読まないため） */
export function HomeIntro({ participants }: HomeIntroProps) {
  const searchParams = useSearchParams();
  if (searchParams.get("issue")) return null;

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-24 -z-10 h-64 w-64 rounded-full bg-accent/25 blur-[80px] dark:bg-accent/20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 left-40 -z-10 h-48 w-48 rounded-full bg-hot/15 blur-[70px]"
      />

      {participants > 0 && (
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised px-4 py-1.5 text-xs font-bold text-ink-secondary shadow-subtle">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-pulse-hot rounded-full bg-hot" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-hot" />
          </span>
          累計
          <span className="text-ink">{formatNumber(participants)}</span>
          人が議論に参加中
        </div>
      )}

      <div>
        <p className="mt-3 bg-gradient-to-r from-ink via-accent to-hot bg-clip-text text-5xl font-extrabold tracking-tighter text-transparent sm:text-6xl lg:text-7xl">
          {SITE.displayName}
        </p>
        <h1 className="mt-2 text-xl font-semibold leading-snug tracking-tight text-ink-secondary sm:mt-3 text-balance">
          日本の議論をもっと分かりやすく、クリーンに。
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-muted sm:mt-3">
          時事問題・政治・経済・金融・戦争・人権など、一次情報にもとづいてファクトを分かりやすく解説。日本のあらゆる問題をリアルタイムでみんなで投票・議論できます。
        </p>
        <Link
          href="/about"
          className="mt-5 flex max-w-md flex-col gap-1 rounded-2xl border border-border bg-surface-raised px-5 py-3.5 text-sm no-underline shadow-subtle transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow sm:flex-row sm:items-center sm:gap-3"
        >
          <span className="font-bold text-ink">FactBaseを知る</span>
          <span className="text-xs text-ink-muted">一次情報 · クリーンな議論 · 国内限定 →</span>
        </Link>
      </div>
    </div>
  );
}
