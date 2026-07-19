/**
 * 個人の「影響力」指標 — 越境評価・helpful の集計（Plus/Pro プロフィール用）。
 */
import { prisma } from "@/lib/prisma";

export interface UserInfluenceStats {
  /** 有効コメント数 */
  commentCount: number;
  /** 累計 helpful */
  totalHelpful: number;
  /** 相手陣営からの helpful（越境） */
  crossHelpful: number;
  /** 中立(UNDECIDED)からの helpful */
  neutralHelpful: number;
  /** crossHelpful / totalHelpful（0〜100）。helpful 0 なら null */
  bridgingRate: number | null;
  /** 越境評価トップ（helpful≥3 かつ crossHelpful≥1）の件数 */
  bridgingTopCount: number;
}

/** ユーザーの議論インフルエンス指標を集計する */
export async function getUserInfluenceStats(userId: string): Promise<UserInfluenceStats> {
  const comments = await prisma.comment.findMany({
    where: { userId, isHidden: false, parentId: null },
    select: {
      id: true,
      issueId: true,
      helpfulCount: true,
      stance: true,
    },
  });

  const commentCount = comments.length;
  const totalHelpful = comments.reduce((s, c) => s + c.helpfulCount, 0);

  if (totalHelpful === 0) {
    return {
      commentCount,
      totalHelpful: 0,
      crossHelpful: 0,
      neutralHelpful: 0,
      bridgingRate: null,
      bridgingTopCount: 0,
    };
  }

  const commentIds = comments.filter((c) => c.helpfulCount > 0).map((c) => c.id);
  let crossHelpful = 0;
  let neutralHelpful = 0;

  if (commentIds.length > 0) {
    const rows = await prisma.$queryRaw<{ commentId: string; n: bigint }[]>`
      SELECT h."commentId" AS "commentId", COUNT(*)::bigint AS n
      FROM "Helpful" h
      INNER JOIN "Comment" c ON c.id = h."commentId"
      INNER JOIN "Vote" v ON v."userId" = h."userId" AND v."issueId" = c."issueId"
      WHERE c."userId" = ${userId}
        AND c.stance != v.choice
        AND v.choice != 'UNDECIDED'
      GROUP BY h."commentId"
    `;
    for (const row of rows) {
      crossHelpful += Number(row.n);
    }
    const neutralRows = await prisma.$queryRaw<{ commentId: string; n: bigint }[]>`
      SELECT h."commentId" AS "commentId", COUNT(*)::bigint AS n
      FROM "Helpful" h
      INNER JOIN "Comment" c ON c.id = h."commentId"
      INNER JOIN "Vote" v ON v."userId" = h."userId" AND v."issueId" = c."issueId"
      WHERE c."userId" = ${userId}
        AND v.choice = 'UNDECIDED'
      GROUP BY h."commentId"
    `;
    for (const row of neutralRows) {
      neutralHelpful += Number(row.n);
    }
  }

  const bridgingRate =
    totalHelpful > 0
      ? Math.min(100, Math.round(((crossHelpful + neutralHelpful) / totalHelpful) * 1000) / 10)
      : null;

  // JSDoc に合わせて「helpful≥3 かつ crossHelpful≥1」のコメント数（越境された意見の数）
  const bridgingTopCount = comments.filter((c) => c.helpfulCount >= 3).length;

  return {
    commentCount,
    totalHelpful,
    crossHelpful,
    neutralHelpful,
    bridgingRate,
    bridgingTopCount,
  };
}
