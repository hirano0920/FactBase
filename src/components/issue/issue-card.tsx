import Link from "next/link";
import { CATEGORIES } from "@/lib/constants";
import { ChartBarIcon, MessageCircleIcon } from "@/components/ui/icons";
import { formatNumber } from "@/lib/utils";
import { IssueThumbnail } from "@/components/issue/issue-thumbnail";
import type { Issue } from "@/types";

interface IssueCardProps {
  issue: Issue;
  /** trueなら賛成/反対の内訳を隠す（ホーム画面用。結果を見る前にまず読んでもらう） */
  hideResults?: boolean;
  /** 指定時はリンクではなくホーム内展開。scrollToVoteがtrueなら投票パネルまで飛ばして開く */
  onSelect?: (opts?: { scrollToVote?: boolean }) => void;
}

/**
 * 争点カード。開かなくても「何が争点か・どれだけ議論されているか」が
 * 数秒でわかることを最優先にした設計。グロー演出は一覧で繰り返すとノイズになるため使わず、
 * 派手さより余白と文字の精度で魅せる（グローは1画面に1枚だけの注目カードに残す）。
 *
 * サムネイルはカード幅いっぱいに全面表示し、カテゴリピルを画像上に重ねる（案B）。
 * 画像分の高さが増える代わりに、カテゴリを別行にしないことでテキスト側の密度を上げている。
 *
 * タイトル部分と「投票する」部分でクリック先を分ける: 記事目当てのユーザーは
 * タイトルから要点を読みつつ開き、スレッド目当てのユーザーは「投票する」から
 * 投票パネル（＝スレッドの入り口）まで一気に飛べるようにする。
 */
export function IssueCard({ issue, onSelect }: IssueCardProps) {
  const { totalVoters } = issue.voteTally;
  const categoryLabel = CATEGORIES.find((c) => c.id === issue.category)?.label ?? issue.category;

  const headlineBlock = (
    <>
      <IssueThumbnail
        src={issue.thumbnailUrl}
        alt=""
        sourceFeed={issue.thumbnailSourceFeed}
        categoryLabel={categoryLabel}
        className="w-full aspect-[2.2/1] max-h-[180px]"
      />
      <div className="p-5 pb-0 sm:p-6 sm:pb-0">
        <h3 className="text-[16px] font-semibold leading-snug tracking-tight text-ink">
          {issue.shareTitle || issue.title}
        </h3>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-muted">{issue.summary.lead}</p>
      </div>
    </>
  );

  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-surface-raised transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_4px_16px_rgb(15_20_25_/_0.06)]">
      {onSelect ? (
        <button type="button" onClick={() => onSelect()} className="block w-full text-left">
          {headlineBlock}
        </button>
      ) : (
        <Link href={`/issues/${issue.slug}`} className="block w-full text-left no-underline">
          {headlineBlock}
        </Link>
      )}

      <div className="flex items-center justify-between border-t border-border p-5 pt-3 sm:p-6 sm:pt-3">
        <span className="flex items-center gap-3 text-xs text-ink-faint tabular-nums">
          <span className="flex items-center gap-1">
            <ChartBarIcon className="h-[13px] w-[13px]" />
            {formatNumber(totalVoters)}
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
