import { prisma } from "@/lib/prisma";

export type UserPublicStats = {
  visibleCommentCount: number;
  totalLikes: number;
};

/** 表示対象コメントのみ集計（非表示・連投ブロック分は tier に含めない） */
export async function getUserPublicStats(userId: string): Promise<UserPublicStats> {
  const agg = await prisma.comment.aggregate({
    where: { userId, isHidden: false },
    _count: { _all: true },
    _sum: { likeCount: true },
  });
  return {
    visibleCommentCount: agg._count._all,
    totalLikes: agg._sum.likeCount ?? 0,
  };
}

export async function getUserPublicStatsBatch(
  userIds: string[],
): Promise<Map<string, UserPublicStats>> {
  const map = new Map<string, UserPublicStats>();
  if (userIds.length === 0) return map;

  const rows = await prisma.comment.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, isHidden: false },
    _count: { _all: true },
    _sum: { likeCount: true },
  });

  for (const id of userIds) {
    map.set(id, { visibleCommentCount: 0, totalLikes: 0 });
  }
  for (const row of rows) {
    map.set(row.userId, {
      visibleCommentCount: row._count._all,
      totalLikes: row._sum.likeCount ?? 0,
    });
  }
  return map;
}
