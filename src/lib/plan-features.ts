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
