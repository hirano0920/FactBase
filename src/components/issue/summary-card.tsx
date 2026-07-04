import Link from "next/link";
import type { IssueSummary } from "@/types";

interface SummaryCardProps {
  summary: IssueSummary;
  articleSlug?: string;
}

export function SummaryCard({ summary, articleSlug }: SummaryCardProps) {
  return (
    <div className="space-y-5">
      <p className="text-base leading-relaxed text-ink-secondary">{summary.lead}</p>

      {summary.bullets.length > 0 && (
        <ul className="space-y-2.5 border-l-2 border-border pl-5">
          {summary.bullets.map((bullet) => (
            <li key={bullet} className="text-sm leading-relaxed text-ink-secondary">
              {bullet}
            </li>
          ))}
        </ul>
      )}

      {summary.sources.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          <span className="text-xs font-medium uppercase tracking-wider text-ink-faint">
            出典
          </span>
          {summary.sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-link underline-offset-2 hover:underline"
            >
              {source.label}
            </a>
          ))}
        </div>
      )}

      {articleSlug && (
        <Link
          href={`/issues/${articleSlug}/article`}
          className="inline-flex items-center text-sm font-medium text-link no-underline hover:underline"
        >
          詳しい解説を読む →
        </Link>
      )}
    </div>
  );
}
