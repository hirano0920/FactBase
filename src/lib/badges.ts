/**
 * 称号(UserBadge)システム。
 * 「役に立った」評価の累計数でカテゴリ別にBronze→Silver→Gold→Proへ昇格する。
 * 特典はバッジ表示と並び順のわずかな優先のみ（票の重み・FC無制限は付けない＝課金価値を奪わない）。
 */
import { prisma } from "@/lib/prisma";
import { BADGE_TIERS, type BadgeTier } from "@/lib/constants";
import type { IssueCategory } from "@prisma/client";

/** 累計数から称号ランクを決める。閾値未満はnull（称号なし）。 */
export function tierForCount(count: number): BadgeTier | null {
  for (const { tier, min } of BADGE_TIERS) {
    if (count >= min) return tier;
  }
  return null;
}

export function tierLabel(tier: string): string {
  return BADGE_TIERS.find((t) => t.tier === tier)?.label ?? tier;
}

/**
 * コメントへの「役に立った」加算後に呼ぶ。該当ユーザー×カテゴリのUserBadgeを更新。
 * 閾値をまたいでいなければtier据え置き（helpfulCountだけ増える）。
 */
export async function awardHelpful(userId: string, category: IssueCategory): Promise<void> {
  const existing = await prisma.userBadge.findUnique({
    where: { userId_category: { userId, category } },
    select: { helpfulCount: true },
  });
  const nextCount = (existing?.helpfulCount ?? 0) + 1;
  const tier = tierForCount(nextCount);
  if (!tier) return; // 最低閾値未満はレコードを作らない（表示するものがないため）

  await prisma.userBadge.upsert({
    where: { userId_category: { userId, category } },
    create: { userId, category, tier, helpfulCount: nextCount },
    update: { tier, helpfulCount: nextCount },
  });
}
