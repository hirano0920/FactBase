import Link from "next/link";
import { cn } from "@/lib/utils";
import type { IssueSummary } from "@/types";

interface SummaryCardProps {
  summary: IssueSummary;
  articleSlug?: string;
  /** ページ上部の第一印象を軽くするための省略表示（詳細解説へのリンクで補う） */
  compact?: boolean;
}

interface ParsedBullet {
  label: string | null;
  text: string;
}

/** bulletsは "ラベル: 本文" 形式（debateTypeBulletsSpec参照）。ラベルと本文を分離する */
function parseBullet(bullet: string): ParsedBullet {
  const match = bullet.match(/^([^：:]{1,20})[：:]\s*([\s\S]+)$/);
  if (!match) return { label: null, text: bullet };
  return { label: match[1].trim(), text: match[2].trim() };
}

export function SummaryCard({ summary, articleSlug, compact = false }: SummaryCardProps) {
  const bullets = compact ? summary.bullets.slice(0, 3) : summary.bullets;

  // 1項目目=中立の前提（いま分かっていること）、2・3項目目=対立する両論。
  // これが揃っている時だけ「賛成/反対を左右に対置する」表示にする。揃わない場合は従来通りの単純リストにフォールバック。
  const [context, sideA, sideB] = bullets;
  const canSplit = bullets.length === 3 && context && sideA && sideB;
  const parsedSideA = canSplit ? parseBullet(sideA) : null;
  const parsedSideB = canSplit ? parseBullet(sideB) : null;
  const parsedContext = canSplit ? parseBullet(context) : null;

  return (
    <div className={compact ? "space-y-2" : "space-y-5"}>
      <p
        className={cn(
          "leading-relaxed text-ink-secondary",
          compact ? "line-clamp-2 text-sm" : "text-base",
        )}
      >
        {summary.lead}
      </p>

      {canSplit && parsedContext && parsedSideA && parsedSideB ? (
        <div className={compact ? "space-y-2" : "space-y-3"}>
          <p
            className={cn(
              "border-l-2 border-border pl-3.5 leading-relaxed text-ink-muted",
              compact ? "line-clamp-1 text-xs" : "text-sm",
            )}
          >
            {parsedContext.text}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div
              className={cn(
                "rounded-lg border-l-4 border-for bg-for-muted",
                compact ? "p-2.5" : "p-3.5",
              )}
            >
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-for">
                {parsedSideA.label ?? "賛成側"}
              </p>
              <p
                className={cn(
                  "leading-relaxed text-ink-secondary",
                  compact ? "line-clamp-2 text-xs" : "text-sm",
                )}
              >
                {parsedSideA.text}
              </p>
            </div>
            <div
              className={cn(
                "rounded-lg border-l-4 border-against bg-against-muted",
                compact ? "p-2.5" : "p-3.5",
              )}
            >
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-against">
                {parsedSideB.label ?? "反対側"}
              </p>
              <p
                className={cn(
                  "leading-relaxed text-ink-secondary",
                  compact ? "line-clamp-2 text-xs" : "text-sm",
                )}
              >
                {parsedSideB.text}
              </p>
            </div>
          </div>
        </div>
      ) : (
        bullets.length > 0 && (
          <ul
            className={cn(
              "space-y-1.5 border-l-2 border-border",
              compact ? "pl-3.5 text-xs" : "space-y-2.5 pl-5 text-sm",
            )}
          >
            {bullets.map((bullet) => (
              <li
                key={bullet}
                className={cn("leading-relaxed text-ink-secondary", compact && "line-clamp-1")}
              >
                {bullet}
              </li>
            ))}
          </ul>
        )
      )}

      {!compact && summary.sources.length > 0 && (
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
          className={cn(
            "inline-flex items-center font-medium text-link no-underline hover:underline",
            compact ? "text-xs" : "text-sm",
          )}
        >
          詳しい解説と出典を読む →
        </Link>
      )}
    </div>
  );
}
