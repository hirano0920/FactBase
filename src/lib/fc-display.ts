import type { FcVerdictId } from "@/types";
import type { Plan } from "@prisma/client";

/** FC判定結果の表示スタイル。投稿済みコメントのFC結果表示と投稿前チェックの警告バナーで共有する */
export const VERDICT_STYLES: Record<FcVerdictId, { label: string; className: string }> = {
  true: { label: "出典で確認", className: "border-for/30 bg-for-muted text-for" },
  false: { label: "出典と矛盾", className: "border-against/30 bg-against-muted text-against" },
  reported: { label: "報道・声明ベース", className: "border-amber-500/30 bg-amber-50 text-amber-800" },
  disputed: { label: "当事者間で対立", className: "border-accent/30 bg-accent/5 text-accent" },
  unknown: { label: "出典では確認不可", className: "border-border bg-surface-muted text-ink-secondary" },
  opinion: { label: "意見・評価", className: "border-border bg-surface-muted text-ink-muted" },
};

/** ✅検証済みバッジを付与するか（Plus/Pro + TRUE判定のみ） */
export function qualifiesVerifiedBadge(
  verdict: string | null | undefined,
  plan: Plan,
): boolean {
  if (verdict !== "TRUE") return false;
  return plan === "COMMENT" || plan === "FACTCHECK";
}

/** バッジの表示ラベル */
export const VERIFIED_BADGE_LABEL = "出典で確認";
