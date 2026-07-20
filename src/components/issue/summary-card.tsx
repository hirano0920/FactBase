import Link from "next/link";
import { cn } from "@/lib/utils";
import { debateTypeHasPolarity, detectForSideIndex, type DebateType } from "@/lib/debate-type";
import { parseBullet, splitClaimAndPoints } from "@/lib/summary-display";
import { renderTextWithGlossary } from "@/lib/glossary-render";
import type { GlossaryTerm, IssueSummary } from "@/types";

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
  /** 難語ポップオーバー用語集。未生成（旧記事）はundefined/[]で、その場合は素の文字列のまま表示 */
  glossary?: GlossaryTerm[] | null;
  /**
   * newsは対立の芯（賛成/反対の分割表示）を出さず、解説メインの長めのleadをそのまま読ませる。
   * スレッド（議論）が主役のdebateとは逆に、記事の読了自体が目的のため。
   */
  variant?: "debate" | "news";
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
  glossary = null,
  variant = "debate",
}: SummaryCardProps) {
  const bullets = summary.bullets.slice(0, 3);
  const [context, sideA, sideB] = bullets;
  const canSplit = variant === "debate" && bullets.length === 3 && Boolean(sideA && sideB);
  const parsedContext = context ? parseBullet(context) : null;
  const parsedSideA = canSplit ? parseBullet(sideA) : null;
  const parsedSideB = canSplit ? parseBullet(sideB) : null;
  const hasPolarity = debateTypeHasPolarity(debateType);
  const sideAParts = parsedSideA ? splitClaimAndPoints(parsedSideA.text) : null;
  const sideBParts = parsedSideB ? splitClaimAndPoints(parsedSideB.text) : null;
  // bulletsはJSON配列の自由文なので、プロンプト上「賛成側が先」という順序指示をAIが必ず守るとは限らない。
  // 見出しラベルの文言から賛成寄り/反対寄りを判定し、判定できない時だけ生成順(A=賛成)にフォールバックする
  const aIsFor = detectForSideIndex(parsedSideA?.label ?? "", parsedSideB?.label ?? "") !== 1;

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
          {renderTextWithGlossary(summary.lead, glossary)}
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
              {renderTextWithGlossary(parsedContext.text, glossary)}
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
                tone={hasPolarity ? (aIsFor ? "for" : "against") : "accent"}
                compact={compact}
                glossary={glossary}
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
                tone={hasPolarity ? (aIsFor ? "against" : "for") : "warm"}
                compact={compact}
                glossary={glossary}
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
                      {renderTextWithGlossary(parsed.text, glossary)}
                    </>
                  ) : (
                    renderTextWithGlossary(bullet, glossary)
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
  glossary,
}: {
  label: string;
  claim: string;
  /** 芯の主張だけでは「何が問題か」が伝わらないため、根拠の一文も添える（splitClaimAndPointsの残り） */
  points?: string[];
  tone: "for" | "against" | "accent" | "warm";
  compact: boolean;
  glossary?: GlossaryTerm[] | null;
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
        {renderTextWithGlossary(claim, glossary)}
      </p>
      {points && points.length > 0 && (
        // line-clampで省略すると文の途中でぶつ切りになり、読者が「読めるようで読めない」
        // 状態になる（実例で指摘あり）。根拠を見せるのが目的なので、省略はせず全文out表示する。
        <p className={cn("pl-2 mt-1.5 leading-snug text-ink-secondary", compact ? "text-xs" : "text-[13px]")}>
          {renderTextWithGlossary(points.join(" "), glossary)}
        </p>
      )}
    </div>
  );
}
