"use client";

import { ChartBarIcon, MessageCircleIcon } from "@/components/ui/icons";
import { formatNumber } from "@/lib/utils";
import { IssueThumbnail } from "@/components/issue/issue-thumbnail";
import Link from "next/link";
import type { Issue } from "@/types";

export type HotIssueBadge = "most-read" | "most-active";

const BADGE_LABEL: Record<HotIssueBadge, string> = {
  "most-read": "今一番読まれてる",
  "most-active": "今一番盛り上がってる",
};

interface HotIssueCardProps {
  issue: Issue;
  badge: HotIssueBadge;
  /** 指定時はリンクではなくホーム内展開 */
  onSelect?: (opts?: { scrollToVote?: boolean }) => void;
}

/**
 * ホーム上部の小型ハイライト。大きなヒーローではなく、2カラムで並ぶコンパクトカード。
 */
export function HotIssueCard({ issue, badge, onSelect }: HotIssueCardProps) {
  const { totalVoters } = issue.voteTally;
  const isActive = badge === "most-active";
  // Newsトラックには投票パネル自体が存在しない（news-debate-template-split.mdで削除済み）ため、
  // #vote-panelへのリンクも「投票する」文言も出さない（存在しないアンカーへの壊れたリンクになる）
  const isDebate = issue.track === "debate";

  const body = (
    <>
      <div className="relative aspect-[16/9] w-full overflow-hidden sm:aspect-[2/1]">
        <IssueThumbnail
          src={issue.thumbnailUrl}
          alt=""
          sourceFeed={issue.thumbnailSourceFeed}
          className="h-full w-full"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/55 to-transparent"
        />
        <div
          className={`pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-full px-2 py-0.5 backdrop-blur-sm ${
            isActive ? "bg-hot/90" : "bg-black/70"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-white" : "bg-accent"}`}
          />
          <span className="text-[10px] font-semibold tracking-wide text-white">
            {BADGE_LABEL[badge]}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3.5 pb-0">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-ink">
          {issue.shareTitle || issue.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-muted">
          {issue.summary.lead}
        </p>
      </div>
    </>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised transition-colors hover:bg-surface-muted">
      {onSelect ? (
        <button type="button" onClick={() => onSelect()} className="flex flex-1 flex-col text-left">
          {body}
        </button>
      ) : (
        <Link
          href={`/issues/${issue.slug}`}
          className="flex flex-1 flex-col text-left no-underline"
        >
          {body}
        </Link>
      )}

      <div className="mt-auto flex items-center justify-between border-t border-border px-3.5 py-2.5">
        <span className="flex items-center gap-2.5 text-xs text-ink-faint tabular-nums">
          {isDebate && (
            <span className="flex items-center gap-1">
              <ChartBarIcon className="h-[13px] w-[13px]" />
              {formatNumber(totalVoters)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <MessageCircleIcon className="h-[13px] w-[13px]" />
            {formatNumber(issue.commentCount)}
          </span>
        </span>
        {isDebate &&
          (onSelect ? (
            <button
              type="button"
              onClick={() => onSelect({ scrollToVote: true })}
              className="text-xs font-medium text-accent hover:underline"
            >
              投票 →
            </button>
          ) : (
            <Link
              href={`/issues/${issue.slug}#vote-panel`}
              className="text-xs font-medium text-accent no-underline hover:underline"
            >
              投票 →
            </Link>
          ))}
      </div>
    </div>
  );
}

interface HotIssueDuoProps {
  mostRead?: Issue;
  mostActive?: Issue;
  onSelect: (slug: string, opts?: { scrollToVote?: boolean }) => void;
}

/** ホーム先頭の「読まれてる / 盛り上がってる」2分割 */
export function HotIssueDuo({ mostRead, mostActive, onSelect }: HotIssueDuoProps) {
  if (!mostRead && !mostActive) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {mostRead && (
        <HotIssueCard
          issue={mostRead}
          badge="most-read"
          onSelect={(opts) => onSelect(mostRead.slug, opts)}
        />
      )}
      {mostActive && (
        <HotIssueCard
          issue={mostActive}
          badge="most-active"
          onSelect={(opts) => onSelect(mostActive.slug, opts)}
        />
      )}
    </div>
  );
}
