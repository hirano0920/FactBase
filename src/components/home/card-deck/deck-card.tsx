"use client";

import { CATEGORIES } from "@/lib/constants";
import { IssueThumbnail } from "@/components/issue/issue-thumbnail";
import { TrackBadge } from "@/components/issue/track-badge";
import { SwingIndicator } from "@/components/issue/swing-indicator";
import type { Issue } from "@/types";

interface DeckCardProps {
  issue: Issue;
  onSkip: () => void;
  onRead: () => void;
  onOpen: () => void;
}

/** 1枚ずつ判断するためのカード本体。クリックで詳細へ、ボタンでスキップ/あとで読む */
export function DeckCard({ issue, onSkip, onRead, onOpen }: DeckCardProps) {
  const categoryLabel = CATEGORIES.find((c) => c.id === issue.category)?.label ?? issue.category;
  const sourceCount = issue.summary.sourceCount ?? issue.summary.sources?.length ?? 0;

  return (
    <div
      key={issue.id}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className="animate-fade-slide-up cursor-pointer rounded-[20px] border border-border bg-surface-raised p-6 shadow-card transition-shadow hover:shadow-glow sm:p-7"
    >
      <div className="mb-3.5 flex items-center gap-2">
        <TrackBadge track={issue.track} />
        <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-bold text-ink-secondary">
          {categoryLabel}
        </span>
      </div>

      <h2 className="text-balance mb-4 text-xl font-extrabold leading-tight tracking-tight text-ink sm:text-2xl">
        {issue.shareTitle || issue.title}
      </h2>

      {issue.thumbnailUrl && (
        <IssueThumbnail
          src={issue.thumbnailUrl}
          alt=""
          sourceFeed={issue.thumbnailSourceFeed}
          className="mb-4 aspect-[16/9] w-full rounded-2xl"
        />
      )}

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-semibold text-ink-secondary">
        {sourceCount > 0 && <span>🔎 {sourceCount}ソース参照</span>}
      </div>
      <SwingIndicator slug={issue.slug} initialSwing={null} labels={issue.voteLabels} />

      <div className="my-4 flex items-center gap-2.5" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-extrabold tracking-wide text-ink-faint">30秒でわかる</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <p className="text-[14.5px] leading-relaxed text-ink-secondary">{issue.summary.lead}</p>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSkip();
          }}
          className="flex flex-col items-center gap-0.5 rounded-2xl border-[1.5px] border-border px-3 py-3.5 text-[14.5px] font-extrabold text-ink-secondary transition-colors hover:border-against hover:bg-against-muted hover:text-against"
        >
          ← スキップ
          <span className="text-[10.5px] font-bold opacity-60">J</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRead();
          }}
          className="flex flex-col items-center gap-0.5 rounded-2xl border-[1.5px] border-border px-3 py-3.5 text-[14.5px] font-extrabold text-ink-secondary transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
        >
          読む →
          <span className="text-[10.5px] font-bold opacity-60">K</span>
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-ink-faint">
        クリックまたは <kbd className="rounded border border-border-strong bg-surface px-1 py-0.5 text-[10.5px] font-bold">Enter</kbd> で詳細を開く
      </p>
    </div>
  );
}
