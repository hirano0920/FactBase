import { prisma } from "@/lib/prisma";
import type { VoteChoice } from "@prisma/client";
import { enumToChoice } from "@/lib/votes";
import type { VoteChoiceId } from "@/lib/constants";

export interface VoteSwing {
  hoursAgo: number;
  /** 直近hoursAgo時間より前の時点でのpercent（%）。DB由来なので±0.1%程度の丸め誤差はある */
  pastPercents: Record<VoteChoiceId, number>;
  /** 現在のpercent（%） */
  currentPercents: Record<VoteChoiceId, number>;
  /** 現在 - 過去（パーセントポイント）。正なら支持が伸びている */
  deltaPoints: Record<VoteChoiceId, number>;
  /** 期間中に新しく入った票数（過去時点でまだ無かった投票者数） */
  newVotes: number;
}

const MIN_VOTES_FOR_SWING = 20;
const MIN_NEW_VOTES_FOR_SWING = 5;

function toPercents(counts: Record<VoteChoiceId, number>): Record<VoteChoiceId, number> {
  const total = counts.for + counts.against + counts.undecided;
  if (total === 0) return { for: 0, against: 0, undecided: 0 };
  return {
    for: Math.round((counts.for / total) * 1000) / 10,
    against: Math.round((counts.against / total) * 1000) / 10,
    undecided: Math.round((counts.undecided / total) * 1000) / 10,
  };
}

async function countsAt(issueId: string, cutoff: Date | null): Promise<Record<VoteChoiceId, number>> {
  const rows = await prisma.vote.groupBy({
    by: ["choice"],
    where: cutoff ? { issueId, createdAt: { lte: cutoff } } : { issueId },
    _count: { _all: true },
  });
  const counts: Record<VoteChoiceId, number> = { for: 0, against: 0, undecided: 0 };
  for (const r of rows) {
    counts[enumToChoice[r.choice as VoteChoice]] = r._count._all;
  }
  return counts;
}

/**
 * 投票の「揺れ」= 直近hoursAgo時間で賛否のpercentがどう動いたか。
 * VoteはuserId+issueIdでユニーク（投票変更時はchoiceを上書き、createdAtは初回投票時刻のまま）なので、
 * 「その時点で誰が何に投票していたか」の完全な再現ではなく、
 * 「その時点までに投票した人が“今”何に投票しているか」の近似値になる
 * （投票を変更する人は少ない前提の、方向感を見るための指標）。
 * 母数が少ない争点はノイズが支配的になるため、閾値未満はnullを返し表示させない。
 */
export async function getVoteSwing(issueId: string, hoursAgo = 3): Promise<VoteSwing | null> {
  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60_000);
  const [pastCounts, currentCounts] = await Promise.all([
    countsAt(issueId, cutoff),
    countsAt(issueId, null),
  ]);
  const pastTotal = pastCounts.for + pastCounts.against + pastCounts.undecided;
  const currentTotal = currentCounts.for + currentCounts.against + currentCounts.undecided;
  const newVotes = currentTotal - pastTotal;

  if (currentTotal < MIN_VOTES_FOR_SWING || newVotes < MIN_NEW_VOTES_FOR_SWING) {
    return null;
  }

  const pastPercents = toPercents(pastCounts);
  const currentPercents = toPercents(currentCounts);
  return {
    hoursAgo,
    pastPercents,
    currentPercents,
    deltaPoints: {
      for: Math.round((currentPercents.for - pastPercents.for) * 10) / 10,
      against: Math.round((currentPercents.against - pastPercents.against) * 10) / 10,
      undecided: Math.round((currentPercents.undecided - pastPercents.undecided) * 10) / 10,
    },
    newVotes,
  };
}
