"use client";

import { ChartBarIcon, MessageCircleIcon } from "@/components/ui/icons";
import { formatNumber } from "@/lib/utils";
import { IssueThumbnail } from "@/components/issue/issue-thumbnail";
import Link from "next/link";
import type { Issue } from "@/types";

interface HotIssueCardProps {
  issue: Issue;
  hideResults?: boolean;
  /** 指定時はリンクではなくホーム内展開。scrollToVoteがtrueなら投票パネルまで飛ばして開く */
  onSelect?: (opts?: { scrollToVote?: boolean }) => void;
}

/**
 * いちばん議論が活発な争点の強調カード。グローは控えめに1箇所だけ、他は通常カードと同じ静かなトーン。
 * タイトルと「投票する」でクリック先を分ける設計はIssueCardと同じ（記事派/スレッド派の分岐）。
 * サムネイルは全面表示し、「今、一番読まれている」バッジを画像上に重ねる（案B: IssueCardと
 * 同じくメタ情報を画像に統合する方針）。
 */
export function HotIssueCard({ issue, onSelect }: HotIssueCardProps) {
  const { totalVoters } = issue.voteTally;

  const headlineBlock = (
    <>
      <div className="relative w-full aspect-[2.4/1] max-h-[220px] sm:max-h-[260px]">
        <IssueThumbnail
          src={issue.thumbnailUrl}
          alt=""
          sourceFeed={issue.thumbnailSourceFeed}
          className="h-full w-full"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/60 to-transparent"
        />
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="text-[11px] font-semibold tracking-[0.05em] text-white">
            今、一番読まれている
          </span>
        </div>
      </div>
      <div className="p-6 pb-0 sm:p-7 sm:pb-0">
        <h3 className="text-[22px] font-semibold leading-snug tracking-tight text-ink sm:text-2xl">
          {issue.shareTitle || issue.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-secondary">{issue.summary.lead}</p>
      </div>
    </>
  );

  return (
    <div className="relative overflow-hidden rounded-[20px] border border-border bg-surface-raised transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgb(15_20_25_/_0.06)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 z-10 h-52 w-52 rounded-full bg-accent/[0.08] blur-[60px]"
      />

      {onSelect ? (
        <button type="button" onClick={() => onSelect()} className="block w-full text-left">
          {headlineBlock}
        </button>
      ) : (
        <Link href={`/issues/${issue.slug}`} className="block w-full text-left no-underline">
          {headlineBlock}
        </Link>
      )}

      <div className="flex items-center justify-between border-t border-border p-6 pt-3.5 sm:p-7 sm:pt-3.5">
        <span className="flex items-center gap-3 text-xs text-ink-muted tabular-nums">
          <span className="flex items-center gap-1">
            <ChartBarIcon className="h-[13px] w-[13px]" />
            {formatNumber(totalVoters)}人
          </span>
          <span className="flex items-center gap-1">
            <MessageCircleIcon className="h-[13px] w-[13px]" />
            {formatNumber(issue.commentCount)}
          </span>
        </span>
        {onSelect ? (
          <button
            type="button"
            onClick={() => onSelect({ scrollToVote: true })}
            className="group -my-2 -mr-2 flex min-h-11 items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-accent hover:bg-accent/10"
          >
            {totalVoters > 0 ? "投票する" : "最初の一票を"}
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </button>
        ) : (
          <Link
            href={`/issues/${issue.slug}#vote-panel`}
            className="group -my-2 -mr-2 flex min-h-11 items-center gap-1 rounded-md px-2 py-2 text-xs font-medium text-accent no-underline hover:bg-accent/10"
          >
            {totalVoters > 0 ? "投票する" : "最初の一票を"}
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
