import Link from "next/link";
import { cn } from "@/lib/utils";
import { debateTypeHasPolarity, type DebateType } from "@/lib/debate-type";
import { parseBullet, splitClaimAndPoints } from "@/lib/summary-display";
import type { IssueSummary } from "@/types";

interface SummaryCardProps {
  summary: IssueSummary;
  articleSlug?: string;
  /**
   * フィード内の折りたたみ用。スレッド詳細・展開では使わず、
   * 報道の具体内容＋両論を十分読める密度で出す。
   */
  compact?: boolean;
  /**
   * declaration・geopoliticsは賛成/反対の極性を持たない当事者名・陣営名の並置なので、
   * for(緑)/against(赤)で色分けすると「どちらが優勢/正しいか」を誤って示唆してしまう。
   * その場合はaccent/warmの中立配色にする。
   */
  debateType?: DebateType | null;
}

/**
 * 要点カード。
 * 事実 → 対立の芯（一文ずつ）→ 根拠、の順でスキャンできるようにする。
 * lead と「いま分かっていること」の二重長文は避け、split 時は事実欄を優先する。
 */
export function SummaryCard({
  summary,
  articleSlug,
  compact = false,
  debateType = null,
}: SummaryCardProps) {
  const bullets = summary.bullets.slice(0, 3);
  const [context, sideA, sideB] = bullets;
  const canSplit = bullets.length === 3 && Boolean(sideA && sideB);
  const parsedContext = context ? parseBullet(context) : null;
  const parsedSideA = canSplit ? parseBullet(sideA) : null;
  const parsedSideB = canSplit ? parseBullet(sideB) : null;
  const hasPolarity = debateTypeHasPolarity(debateType);
  const sideAParts = parsedSideA ? splitClaimAndPoints(parsedSideA.text) : null;
  const sideBParts = parsedSideB ? splitClaimAndPoints(parsedSideB.text) : null;

  return (
    <div className={compact ? "space-y-2.5" : "space-y-4"}>
      {/* split があるときは長文 lead を先頭に置かない（事実＋両論と内容が重複して読みにくい） */}
      {!canSplit && (
        <p
          className={cn(
            "leading-relaxed text-ink-secondary",
            compact ? "line-clamp-4 text-sm" : "text-base",
          )}
        >
          {summary.lead}
        </p>
      )}

      {canSplit && parsedContext && parsedSideA && parsedSideB && sideAParts && sideBParts ? (
        <div className={compact ? "space-y-3" : "space-y-4"}>
          <div
            className={cn(
              "rounded-xl border border-border bg-surface-muted/70",
              compact ? "px-3 py-2.5" : "px-4 py-3.5",
            )}
          >
            <p className="mb-1.5 text-[11px] font-bold tracking-wide text-ink-faint">
              {parsedContext.label ?? "確認できること"}
            </p>
            <p
              className={cn(
                "leading-relaxed text-ink",
                compact ? "line-clamp-3 text-sm" : "text-[15px]",
              )}
            >
              {parsedContext.text}
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-[11px] font-bold tracking-wide text-ink-faint">対立の芯</p>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </div>

            <div className="relative grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
              <StancePanel
                label={parsedSideA.label ?? "一方の立場"}
                claim={sideAParts.claim}
                points={sideAParts.points}
                tone={hasPolarity ? "for" : "accent"}
                compact={compact}
              />

              <div
                className="hidden items-center justify-center sm:flex"
                aria-hidden
              >
                <span className="rounded-full border border-border bg-surface-raised px-2 py-1 text-[10px] font-extrabold tracking-wider text-ink-faint">
                  VS
                </span>
              </div>
              <p className="text-center text-[10px] font-bold text-ink-faint sm:hidden">対</p>

              <StancePanel
                label={parsedSideB.label ?? "もう一方の立場"}
                claim={sideBParts.claim}
                points={sideBParts.points}
                tone={hasPolarity ? "against" : "warm"}
                compact={compact}
              />
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

      {articleSlug && (
        <Link
          href={`/issues/${articleSlug}/article`}
          className={cn(
            "inline-flex items-center font-medium text-link no-underline hover:underline",
            compact ? "text-xs" : "text-sm",
          )}
        >
          これまでの流れ・詳しい解説を読む →
        </Link>
      )}
    </div>
  );
}

function StancePanel({
  label,
  claim,
  points,
  tone,
  compact,
}: {
  label: string;
  claim: string;
  points: string[];
  tone: "for" | "against" | "accent" | "warm";
  compact: boolean;
}) {
  const shell =
    tone === "for"
      ? "border-for/30 bg-for-muted/50"
      : tone === "against"
        ? "border-against/30 bg-against-muted/50"
        : tone === "accent"
          ? "border-accent/30 bg-accent-soft/80"
          : "border-warm/30 bg-warm-muted/80";
  const labelColor =
    tone === "for"
      ? "text-for"
      : tone === "against"
        ? "text-against"
        : tone === "accent"
          ? "text-accent"
          : "text-warm";
  const bar =
    tone === "for"
      ? "bg-for"
      : tone === "against"
        ? "bg-against"
        : tone === "accent"
          ? "bg-accent"
          : "bg-warm";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border",
        shell,
        compact ? "p-3" : "p-4",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", bar)} aria-hidden />
      <p className={cn("mb-2 pl-2 text-[11px] font-extrabold tracking-wide", labelColor)}>
        {label}
      </p>
      <p
        className={cn(
          "pl-2 font-semibold leading-snug text-ink",
          compact ? "text-sm" : "text-[15px]",
        )}
      >
        {claim}
      </p>
      {points.length > 0 && (
        <ul className={cn("mt-2 space-y-1.5 pl-2", compact ? "text-xs" : "text-sm")}>
          {points.map((point) => (
            <li key={point} className="flex gap-2 leading-relaxed text-ink-secondary">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
