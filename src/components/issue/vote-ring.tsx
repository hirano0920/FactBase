"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatNumber } from "@/lib/utils";
import type { VoteTally } from "@/types";

interface VoteRingProps {
  issueId: string;
  issueSlug: string;
  issueTitle: string;
  initialTally: VoteTally;
}

const SIZE = 208;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function segment(percent: number, offset: number) {
  const len = (percent / 100) * CIRCUMFERENCE;
  return {
    strokeDasharray: `${len} ${CIRCUMFERENCE - len}`,
    strokeDashoffset: -offset,
  };
}

/**
 * ホームHERO用のリアルタイム賛否ゲージ。
 * リング = 賛成(緑)/反対(赤)/わからない(グレー)の内訳を12時起点で時計回りに表示。
 * 中央の大きな数字は優勢な側の割合。SSEで既存の投票ストリームを購読しライブ更新する。
 */
export function VoteRing({ issueId, issueSlug, issueTitle, initialTally }: VoteRingProps) {
  const [tally, setTally] = useState(initialTally);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const source = new EventSource(`/api/votes/stream?issueId=${encodeURIComponent(issueId)}`);
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as VoteTally;
        if (mounted.current) setTally(next);
      } catch {
        // 不正なフレームは無視
      }
    };
    return () => {
      mounted.current = false;
      source.close();
    };
  }, [issueId]);

  const { percents } = tally;
  const diff = Math.abs(percents.for - percents.against);
  const leading = diff < 1.5 ? "even" : percents.for > percents.against ? "for" : "against";

  const leadLabel = leading === "even" ? "拮抗" : leading === "for" ? "賛成" : "反対";
  const leadPercent = leading === "even" ? Math.max(percents.for, percents.against) : percents[leading];
  const glowVar = leading === "against" ? "var(--color-against)" : "var(--color-for)";

  const forSeg = segment(percents.for, 0);
  const againstSeg = segment(percents.against, (percents.for / 100) * CIRCUMFERENCE);
  const undecidedSeg = segment(
    percents.undecided,
    ((percents.for + percents.against) / 100) * CIRCUMFERENCE,
  );

  return (
    <Link
      href={`/issues/${issueSlug}`}
      className="group block no-underline hover:no-underline"
      aria-label={`${issueTitle} の投票結果を見る`}
    >
      <div
        className="relative mx-auto flex items-center justify-center transition-transform duration-300 group-hover:scale-[1.02] dark:[filter:drop-shadow(0_0_28px_var(--glow))]"
        style={{ width: SIZE, height: SIZE, ["--glow" as string]: glowVar }}
      >
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-surface-muted)"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-neutral)"
            strokeOpacity={0.35}
            strokeWidth={STROKE}
            strokeDasharray={undecidedSeg.strokeDasharray}
            strokeDashoffset={undecidedSeg.strokeDashoffset}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-against)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={againstSeg.strokeDasharray}
            strokeDashoffset={againstSeg.strokeDashoffset}
            className="transition-all duration-500"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-for)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={forSeg.strokeDasharray}
            strokeDashoffset={forSeg.strokeDashoffset}
            className="transition-all duration-500"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-serif text-5xl font-semibold tabular-nums text-ink">
            {leadPercent.toFixed(0)}
            <span className="text-2xl">%</span>
          </span>
          <span className="mt-1 text-sm font-medium text-ink-secondary">{leadLabel}が優勢</span>
          <span className="mt-2 text-xs tabular-nums text-ink-faint">
            {formatNumber(tally.totalVoters)}人が投票中
          </span>
        </div>
      </div>
    </Link>
  );
}
