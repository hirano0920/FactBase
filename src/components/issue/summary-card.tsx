import Link from "next/link";
import { cn } from "@/lib/utils";
import type { IssueSummary } from "@/types";

interface SummaryCardProps {
  summary: IssueSummary;
  articleSlug?: string;
  /**
   * フィード内の折りたたみ用。スレッド詳細・展開では使わず、
   * 報道の具体内容＋両論を十分読める密度で出す。
   */
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

/**
 * 要点カード。
 * 二項対立のラベル（「否定」「事実」）だけでは薄いので、
 * 1項目目＝何が報じられたか／何が起きているかを必ず見せ、その下に両側を置く。
 */
export function SummaryCard({ summary, articleSlug, compact = false }: SummaryCardProps) {
  const bullets = summary.bullets.slice(0, 3);
  const [context, sideA, sideB] = bullets;
  const canSplit = bullets.length === 3 && Boolean(sideA && sideB);
  const parsedContext = context ? parseBullet(context) : null;
  const parsedSideA = canSplit ? parseBullet(sideA) : null;
  const parsedSideB = canSplit ? parseBullet(sideB) : null;

  return (
    <div className={compact ? "space-y-2.5" : "space-y-4"}>
      <p
        className={cn(
          "leading-relaxed text-ink-secondary",
          compact ? "line-clamp-4 text-sm" : "text-base",
        )}
      >
        {summary.lead}
      </p>

      {canSplit && parsedContext && parsedSideA && parsedSideB ? (
        <div className={compact ? "space-y-2.5" : "space-y-3"}>
          <div
            className={cn(
              "rounded-lg border border-border bg-surface-muted/60",
              compact ? "px-3 py-2.5" : "px-3.5 py-3",
            )}
          >
            <p className="mb-1 text-[10px] font-bold tracking-wide text-ink-faint">
              {parsedContext.label ?? "いま分かっていること"}
            </p>
            <p
              className={cn(
                "leading-relaxed text-ink-secondary",
                compact ? "line-clamp-3 text-xs" : "text-sm",
              )}
            >
              {parsedContext.text}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div
              className={cn(
                "rounded-lg border-l-4 border-for bg-for-muted",
                compact ? "p-2.5" : "p-3.5",
              )}
            >
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-for">
                {parsedSideA.label ?? "一方の立場"}
              </p>
              <p
                className={cn(
                  "leading-relaxed text-ink-secondary",
                  compact ? "line-clamp-3 text-xs" : "text-sm",
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
                {parsedSideB.label ?? "もう一方の立場"}
              </p>
              <p
                className={cn(
                  "leading-relaxed text-ink-secondary",
                  compact ? "line-clamp-3 text-xs" : "text-sm",
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
            {bullets.map((bullet) => {
              const parsed = parseBullet(bullet);
              return (
                <li
                  key={bullet}
                  className={cn("leading-relaxed text-ink-secondary", compact && "line-clamp-2")}
                >
                  {parsed.label ? (
                    <>
                      <span className="font-semibold text-ink-muted">{parsed.label}: </span>
                      {parsed.text}
                    </>
                  ) : (
                    bullet
                  )}
                </li>
              );
            })}
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
