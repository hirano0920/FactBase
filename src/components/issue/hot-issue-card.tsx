"use client";

import { ChartBarIcon, MessageCircleIcon } from "@/components/ui/icons";
import { formatNumber, formatPercent } from "@/lib/utils";
import Link from "next/link";
import type { Issue } from "@/types";

interface HotIssueCardProps {
  issue: Issue;
  hideResults?: boolean;
  onSelect?: () => void;
}

/** いちばん盛り上がっている争点の強調カード。 */
export function HotIssueCard({ issue, hideResults = false, onSelect }: HotIssueCardProps) {
  const { percents, totalVoters } = issue.voteTally;

  const className =
    "block w-full rounded-2xl border border-hot-border bg-gradient-to-br from-hot-muted to-surface-raised p-5 text-left no-underline shadow-subtle transition-all hover:-translate-y-0.5 hover:shadow-glow sm:p-6";

  const inner = (
    <>
      <div className="mb-2.5 flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-pulse-hot rounded-full bg-hot" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-hot" />
        </span>
        <span className="animate-flicker text-base leading-none">🔥</span>
        <span className="text-xs font-extrabold tracking-wide text-hot">話題沸騰中</span>
      </div>

      <h3 className="text-xl font-extrabold leading-tight tracking-tight text-ink sm:text-2xl">
        {issue.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-secondary">
        {issue.summary.lead}
      </p>

      {hideResults ? (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-extrabold text-ink">賛成？反対？わからない？</span>
          <span className="flex items-center gap-3 text-xs font-semibold text-ink-muted">
            <span className="flex items-center gap-1">
              <ChartBarIcon style={{ width: 13, height: 13 }} />
              {formatNumber(totalVoters)}人
            </span>
            <span className="flex items-center gap-1">
              <MessageCircleIcon style={{ width: 13, height: 13 }} />
              {formatNumber(issue.commentCount)}
            </span>
          </span>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex h-2 overflow-hidden rounded-full bg-surface-raised/70">
            <div className="bg-for" style={{ width: `${percents.for}%` }} />
            <div className="bg-against" style={{ width: `${percents.against}%` }} />
            <div className="bg-neutral/40" style={{ width: `${percents.undecided}%` }} />
          </div>
          <div className="mt-2.5 flex items-center gap-4 text-sm">
            <span className="font-bold text-for">賛成 {formatPercent(percents.for)}</span>
            <span className="font-bold text-against">反対 {formatPercent(percents.against)}</span>
            <span className="ml-auto flex items-center gap-3 text-xs font-semibold text-ink-muted">
              <span className="flex items-center gap-1">
                <ChartBarIcon style={{ width: 13, height: 13 }} />
                {formatNumber(totalVoters)}人
              </span>
              <span className="flex items-center gap-1">
                <MessageCircleIcon style={{ width: 13, height: 13 }} />
                {formatNumber(issue.commentCount)}
              </span>
            </span>
          </div>
        </div>
      )}
    </>
  );

  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} className={className}>
        {inner}
      </button>
    );
  }

  return (
    <Link href={`/issues/${issue.slug}`} className={className}>
      {inner}
    </Link>
  );
}
