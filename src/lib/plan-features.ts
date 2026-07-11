import { FC_DAILY_LIMITS } from "@/lib/constants";
import type { Plan } from "@prisma/client";

/** ログイン済みならコメント投稿可（プラン不問） */
export function canPostComment(isLoggedIn: boolean): boolean {
  return isLoggedIn;
}

/** ワンタップFCは Plus / Pro のみ */
export function canUseFactCheck(plan: Plan | null): boolean {
  return plan === "COMMENT" || plan === "FACTCHECK";
}

/** 無料・Plus は広告表示、Pro は非表示 */
export function planShowsAds(plan: Plan | null | undefined): boolean {
  return plan !== "FACTCHECK";
}

export function fcDailyLimit(plan: Plan): number {
  return FC_DAILY_LIMITS[plan];
}

/** 「層の動き」分析（読前/読後シフト・沈黙の多数派ヒートマップ詳細）はPlus/Proのみ。Freeはn・shift%の概要だけ見える */
export function canViewAnalytics(plan: Plan | null | undefined): boolean {
  return plan === "COMMENT" || plan === "FACTCHECK";
}

/** 両陣営マップ・MVP・詳細インテリジェンスは Plus/Pro */
export function canViewDebateIntelligence(plan: Plan | null | undefined): boolean {
  return plan === "COMMENT" || plan === "FACTCHECK";
}

/** レスバ支援 AI（争点素材ベースの反論候補）は Plus/Pro */
export function canUseRebuttalAi(plan: Plan | null | undefined): boolean {
  return plan === "COMMENT" || plan === "FACTCHECK";
}
