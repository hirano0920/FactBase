import { formatPercent } from "@/lib/utils";
import type { IssueSummary } from "@/types";

interface YahooPollReferenceProps {
  poll: NonNullable<IssueSummary["externalPoll"]>;
}

/**
 * Yahoo!ニュース「みんなの意見」で一致した設問の上位2択を、投票ボタンの直前に参考として出す。
 * 「自分だけでなく世の中でも意見が割れている」ことを投票の意思決定点で見せ、
 * TwoSidesの読者投票への相乗効果を狙う（サイト自前の投票結果とは別物として明示する）。
 */
export function YahooPollReference({ poll }: YahooPollReferenceProps) {
  const top2 = [...poll.choices].sort((a, b) => b.percent - a.percent).slice(0, 2);
  if (top2.length < 2) return null;

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface-muted/60 px-4 py-3 text-sm">
      <p className="mb-2 text-[11px] font-bold tracking-wide text-ink-faint">
        参考: Yahoo!ニュース「みんなの意見」より
      </p>
      <p className="mb-2 leading-snug text-ink-secondary">{poll.question}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {top2.map((c) => (
          <span key={c.choice} className="font-semibold text-ink">
            {c.choice} <span className="tabular-nums text-ink-muted">{formatPercent(c.percent)}</span>
          </span>
        ))}
      </div>
      <a
        href={poll.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="mt-1.5 inline-block text-xs text-link no-underline hover:underline"
      >
        投票結果の詳細を見る →
      </a>
    </div>
  );
}
