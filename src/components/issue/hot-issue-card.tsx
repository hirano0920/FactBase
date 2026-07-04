import Link from "next/link";
import { ChartBarIcon, MessageCircleIcon } from "@/components/ui/icons";
import { formatNumber, formatPercent } from "@/lib/utils";
import type { Issue } from "@/types";

/** いちばん盛り上がっている争点の強調カード。ホーム・一覧の先頭に1件だけ出す。 */
export function HotIssueCard({ issue }: { issue: Issue }) {
  const { percents, totalVoters } = issue.voteTally;

  return (
    <Link
      href={`/issues/${issue.slug}`}
      className="block rounded-2xl border border-hot-border bg-hot-muted p-5 no-underline transition-transform hover:scale-[1.01] sm:p-6"
    >
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
    </Link>
  );
}
