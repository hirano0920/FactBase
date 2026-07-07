import type { Plan } from "@prisma/client";

export interface ReputationTier {
  id: string;
  label: string;
  emoji: string | null;
  colorClass: string;
  minComments: number;
}

export interface LikeTitle {
  id: string;
  label: string;
  emoji: string;
  colorClass: string;
  minLikes: number;
}

/** プラン別 tier（表示可能コメント数ベース） */
export const REPUTATION_LADDERS: Record<Plan, ReputationTier[]> = {
  FREE: [
    {
      id: "newbie",
      label: "Newbie",
      emoji: "🔰",
      colorClass: "text-emerald-600",
      minComments: 0,
    },
  ],
  COMMENT: [
    { id: "tier3", label: "Tier3", emoji: null, colorClass: "text-ink-muted", minComments: 0 },
    { id: "tier2", label: "Tier2", emoji: null, colorClass: "text-sky-600", minComments: 10 },
    { id: "tier1", label: "Tier1", emoji: null, colorClass: "text-violet-600", minComments: 100 },
    {
      id: "professional",
      label: "Professional",
      emoji: "🎓",
      colorClass: "text-accent",
      minComments: 500,
    },
  ],
  FACTCHECK: [
    { id: "amateur", label: "Amateur", emoji: null, colorClass: "text-ink-muted", minComments: 0 },
    {
      id: "proficient",
      label: "Proficient",
      emoji: null,
      colorClass: "text-sky-600",
      minComments: 10,
    },
    {
      id: "professional",
      label: "Professional",
      emoji: "🎓",
      colorClass: "text-violet-600",
      minComments: 150,
    },
    {
      id: "master",
      label: "Master",
      emoji: "👑",
      colorClass: "text-amber-600",
      minComments: 500,
    },
  ],
};

/** 累計 like 数による称号（プロフィールに全文、スレッドには絵文字のみ） */
export const LIKE_TITLES: LikeTitle[] = [
  {
    id: "great-sage",
    label: "Great Sage大賢者",
    emoji: "🤴🏻",
    colorClass: "text-amber-600",
    minLikes: 5000,
  },
  {
    id: "judge",
    label: "The Judge審判",
    emoji: "👨🏻‍⚖️",
    colorClass: "text-violet-600",
    minLikes: 1000,
  },
  {
    id: "philosopher",
    label: "Philosopher哲学者",
    emoji: "🤵🏻‍♂️",
    colorClass: "text-sky-700",
    minLikes: 500,
  },
  {
    id: "scholar",
    label: "Scholar学者",
    emoji: "👨🏻‍🏫",
    colorClass: "text-emerald-700",
    minLikes: 100,
  },
];

export function getUserReputation(plan: Plan, commentCount: number): ReputationTier {
  const ladder = REPUTATION_LADDERS[plan];
  let current = ladder[0];
  for (const tier of ladder) {
    if (commentCount >= tier.minComments) current = tier;
  }
  return current;
}

export function getLikeTitle(totalLikes: number): LikeTitle | null {
  for (const title of LIKE_TITLES) {
    if (totalLikes >= title.minLikes) return title;
  }
  return null;
}

export function reputationProgress(plan: Plan, commentCount: number): {
  current: ReputationTier;
  next: ReputationTier | null;
  commentsToNext: number | null;
} {
  const ladder = REPUTATION_LADDERS[plan];
  const current = getUserReputation(plan, commentCount);
  const idx = ladder.findIndex((t) => t.id === current.id);
  const next = idx >= 0 && idx < ladder.length - 1 ? ladder[idx + 1] : null;
  return {
    current,
    next,
    commentsToNext: next ? Math.max(0, next.minComments - commentCount) : null,
  };
}

export function likeTitleProgress(totalLikes: number): {
  current: LikeTitle | null;
  next: LikeTitle | null;
  likesToNext: number | null;
} {
  const current = getLikeTitle(totalLikes);
  const next =
    LIKE_TITLES.filter((t) => t.minLikes > totalLikes).sort((a, b) => a.minLikes - b.minLikes)[0] ??
    null;
  return {
    current,
    next,
    likesToNext: next ? Math.max(0, next.minLikes - totalLikes) : null,
  };
}
