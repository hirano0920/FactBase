import Link from "next/link";
import { CategoryBadge, StatusBadge } from "@/components/ui/badge";
import { ChartBarIcon, MessageCircleIcon } from "@/components/ui/icons";
import { formatNumber, formatPercent } from "@/lib/utils";
import type { Issue } from "@/types";

/**
 * 争点カード。開かなくても「何が争点か・世論がどう割れているか・どれだけ議論されているか」が
 * 数秒でわかることを最優先にした設計。クリックしたくなるよう見出しとホバー時の続きを読む導線を強調。
 */
export function IssueCard({ issue }: { issue: Issue }) {
  const { percents, totalVoters } = issue.voteTally;
  const hasVotes = totalVoters > 0;

  return (
    <Link
      href={`/issues/${issue.slug}`}
      className="group block rounded-xl border border-border bg-surface-raised p-4 shadow-subtle transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card no-underline sm:p-5"
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <CategoryBadge category={issue.category} />
        <StatusBadge status={issue.status} />
      </div>

      <h3 className="text-lg font-extrabold leading-snug tracking-tight text-ink transition-colors group-hover:text-accent">
        {issue.title}
      </h3>

      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-muted">
        {issue.summary.lead}
      </p>

      {hasVotes ? (
        <div className="mt-4">
          <div
            className="flex h-1.5 overflow-hidden rounded-full bg-surface-muted"
            role="img"
            aria-label={`賛成${formatPercent(percents.for)}、反対${formatPercent(percents.against)}、わからない${formatPercent(percents.undecided)}`}
          >
            <div className="bg-for" style={{ width: `${percents.for}%` }} />
            <div className="bg-against" style={{ width: `${percents.against}%` }} />
            <div className="bg-neutral/50" style={{ width: `${percents.undecided}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-3 font-bold tabular-nums">
              <span className="text-for">賛成 {formatPercent(percents.for)}</span>
              <span className="text-against">反対 {formatPercent(percents.against)}</span>
            </span>
            <span className="flex items-center gap-3 text-xs font-semibold tabular-nums text-ink-faint">
              <span className="flex items-center gap-1">
                <ChartBarIcon style={{ width: 13, height: 13 }} />
                {formatNumber(totalVoters)}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircleIcon style={{ width: 13, height: 13 }} />
                {formatNumber(issue.commentCount)}
              </span>
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-faint">まだ投票がありません — 最初の一票を</p>
      )}

      <div className="mt-3 flex items-center gap-1 text-xs font-bold text-accent opacity-0 transition-opacity group-hover:opacity-100">
        続きを読んで投票する
        <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </div>
    </Link>
  );
}
