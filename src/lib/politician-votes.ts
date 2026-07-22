import { prisma } from "@/lib/prisma";
import type { VoteChoice } from "@prisma/client";
import { enumToChoice, choiceToEnum } from "@/lib/votes";
import type { VoteChoiceId } from "@/lib/constants";

/**
 * 政治家への評価投票の集計。
 * 「総数しか出ない」タイプの人気投票サイトとの差別化ポイントとして、
 * 全体の割合に加えて「直近1週間だけの割合」と「その差（スイング）」を出す。
 * これが「今、評価が動いている」を可視化し、再訪の理由を作る。
 */
export interface PoliticianSupportStats {
  /** 全期間の現在状態（PoliticianVote由来） */
  total: {
    counts: Record<VoteChoiceId, number>;
    percents: Record<VoteChoiceId, number>;
    n: number;
  };
  /** 直近7日間に投じられた票だけの割合（PoliticianVoteEvent由来）。票数が閾値未満ならnull */
  recent: {
    counts: Record<VoteChoiceId, number>;
    percents: Record<VoteChoiceId, number>;
    n: number;
  } | null;
  /** 直近1週間の割合 - 全体の割合（パーセントポイント）。recentがnullならnull */
  deltaPoints: Record<VoteChoiceId, number> | null;
}

/** 直近ウィンドウの割合を出すのに最低限必要な票数（少なすぎるとノイズが支配的になる） */
const MIN_RECENT_VOTES = 10;
/** 全体割合の表示に最低限必要な票数 */
const MIN_TOTAL_VOTES = 5;

function toPercents(counts: Record<VoteChoiceId, number>): Record<VoteChoiceId, number> {
  const total = counts.for + counts.against + counts.undecided;
  if (total === 0) return { for: 0, against: 0, undecided: 0 };
  return {
    for: Math.round((counts.for / total) * 1000) / 10,
    against: Math.round((counts.against / total) * 1000) / 10,
    undecided: Math.round((counts.undecided / total) * 1000) / 10,
  };
}

export async function getPoliticianSupportStats(
  politicianId: string,
): Promise<PoliticianSupportStats> {
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const [totalRows, recentRows] = await Promise.all([
    prisma.politicianVote.groupBy({
      by: ["choice"],
      where: { politicianId },
      _count: { _all: true },
    }),
    prisma.politicianVoteEvent.groupBy({
      by: ["choice"],
      where: { politicianId, createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
  ]);

  const totalCounts: Record<VoteChoiceId, number> = { for: 0, against: 0, undecided: 0 };
  for (const r of totalRows) totalCounts[enumToChoice[r.choice as VoteChoice]] = r._count._all;
  const totalN = totalCounts.for + totalCounts.against + totalCounts.undecided;

  const recentCounts: Record<VoteChoiceId, number> = { for: 0, against: 0, undecided: 0 };
  for (const r of recentRows) recentCounts[enumToChoice[r.choice as VoteChoice]] = r._count._all;
  const recentN = recentCounts.for + recentCounts.against + recentCounts.undecided;

  const totalPercents = toPercents(totalCounts);
  const hasRecent = recentN >= MIN_RECENT_VOTES && totalN >= MIN_TOTAL_VOTES;
  const recentPercents = hasRecent ? toPercents(recentCounts) : null;

  return {
    total: { counts: totalCounts, percents: totalPercents, n: totalN },
    recent: hasRecent ? { counts: recentCounts, percents: recentPercents!, n: recentN } : null,
    deltaPoints: hasRecent
      ? {
          for: Math.round((recentPercents!.for - totalPercents.for) * 10) / 10,
          against: Math.round((recentPercents!.against - totalPercents.against) * 10) / 10,
          undecided: Math.round((recentPercents!.undecided - totalPercents.undecided) * 10) / 10,
        }
      : null,
  };
}

/** 投票を反映する（現在状態を上書き+イベントログを追記）。同じ選択への再投票はログを増やさない */
export async function castPoliticianVote(
  userId: string,
  politicianId: string,
  choice: VoteChoiceId,
): Promise<PoliticianSupportStats> {
  const dbChoice = choiceToEnum[choice];
  const existing = await prisma.politicianVote.findUnique({
    where: { userId_politicianId: { userId, politicianId } },
    select: { choice: true },
  });

  if (existing?.choice !== dbChoice) {
    await prisma.$transaction([
      prisma.politicianVote.upsert({
        where: { userId_politicianId: { userId, politicianId } },
        update: { choice: dbChoice },
        create: { userId, politicianId, choice: dbChoice },
      }),
      prisma.politicianVoteEvent.create({
        data: { userId, politicianId, choice: dbChoice },
      }),
    ]);
  }

  return getPoliticianSupportStats(politicianId);
}

/** ログインユーザーの現在の投票（未投票はnull） */
export async function getMyPoliticianVote(
  userId: string,
  politicianId: string,
): Promise<VoteChoiceId | null> {
  const vote = await prisma.politicianVote.findUnique({
    where: { userId_politicianId: { userId, politicianId } },
    select: { choice: true },
  });
  return vote ? enumToChoice[vote.choice] : null;
}
