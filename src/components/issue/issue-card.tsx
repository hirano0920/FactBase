import Link from "next/link";
import { CATEGORIES } from "@/lib/constants";
import { ChartBarIcon, MessageCircleIcon } from "@/components/ui/icons";
import { formatNumber } from "@/lib/utils";
import { IssueThumbnail } from "@/components/issue/issue-thumbnail";
import { TrackBadge } from "@/components/issue/track-badge";
import type { Issue } from "@/types";

interface IssueCardProps {
  issue: Issue;
  /** trueなら賛成/反対の内訳を隠す（ホーム画面用。結果を見る前にまず読んでもらう） */
  hideResults?: boolean;
  /** 指定時はリンクではなくホーム内展開。scrollToVoteがtrueなら投票パネルまで飛ばして開く */
  onSelect?: (opts?: { scrollToVote?: boolean }) => void;
}

/**
 * 争点カード。X(Twitter)のタイムライン項目を参考にしたトーン:
 * カードの「浮き上がり」演出（lift+shadow）はやめ、ホバーは背景の薄い色替えだけに。
 * サムネイルは全カードに強制せず、実画像がある時だけ表示する
 * （多くの争点はサムネ未取得のため、プレースホルダー画像を毎回並べると単調でノイズになる）。
 * カード下部はアイコン+件数を等間隔に並べる行（返信/いいね相当の配置）に統一。
 *
 * モバイルは縦積み（文章→画像）、sm以上は横並び（画像を左・文章を右）に切り替える。
 * DOM順は変えず`order`だけ入れ替えているので、読み上げ順は常に文章が先。
 */
export function IssueCard({ issue, onSelect }: IssueCardProps) {
  const { totalVoters } = issue.voteTally;
  const categoryLabel = CATEGORIES.find((c) => c.id === issue.category)?.label ?? issue.category;
  // Newsトラックには投票パネル自体が存在しない（news-debate-template-split.mdで削除済み）ため、
  // #vote-panelへのリンクも「投票する」文言も出さない（存在しないアンカーへの壊れたリンクになる）
  const isDebate = issue.track === "debate";

  const body = (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      {issue.thumbnailUrl && (
        <div className="relative order-2 shrink-0 overflow-hidden rounded-2xl sm:order-1 sm:h-[104px] sm:w-[104px]">
          <IssueThumbnail
            src={issue.thumbnailUrl}
            alt=""
            sourceFeed={issue.thumbnailSourceFeed}
            className="aspect-[16/9] w-full sm:aspect-square sm:h-full"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-accent/15 via-transparent to-hot/10"
          />
        </div>
      )}
      <div className="order-1 min-w-0 flex-1 sm:order-2">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-accent to-hot" />
          <TrackBadge track={issue.track} />
          <span className="text-xs font-semibold text-ink-secondary">{categoryLabel}</span>
        </div>
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-ink">
          {issue.shareTitle || issue.title}
        </h3>
        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
          {issue.summary.lead}
        </p>
      </div>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised transition-colors hover:bg-surface-muted">
      {onSelect ? (
        <button type="button" onClick={() => onSelect()} className="block w-full text-left">
          {body}
        </button>
      ) : (
        <Link href={`/issues/${issue.slug}`} className="block w-full text-left no-underline">
          {body}
        </Link>
      )}

      <div className="flex max-w-[240px] items-center justify-between px-2 pb-2">
        <span className="flex min-h-11 items-center gap-1.5 rounded-full px-2 text-xs text-ink-faint transition-colors hover:bg-accent/10 hover:text-accent">
          <MessageCircleIcon className="h-[15px] w-[15px]" />
          {formatNumber(issue.commentCount)}
        </span>
        {isDebate && (
          <span className="flex min-h-11 items-center gap-1.5 rounded-full px-2 text-xs text-ink-faint transition-colors hover:bg-for/10 hover:text-for">
            <ChartBarIcon className="h-[15px] w-[15px]" />
            {formatNumber(totalVoters)}
          </span>
        )}
        {isDebate &&
          (onSelect ? (
            <button
              type="button"
              onClick={() => onSelect({ scrollToVote: true })}
              className="flex min-h-11 items-center rounded-full px-2 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
            >
              {totalVoters > 0 ? "投票する" : "最初の一票を"}
            </button>
          ) : (
            <Link
              href={`/issues/${issue.slug}#vote-panel`}
              className="flex min-h-11 items-center rounded-full px-2 text-xs font-medium text-accent no-underline transition-colors hover:bg-accent/10"
            >
              {totalVoters > 0 ? "投票する" : "最初の一票を"}
            </Link>
          ))}
      </div>
    </div>
  );
}
