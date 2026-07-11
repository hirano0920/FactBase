/**
 * 信頼スコア（B-3）— 主張が検証を通った率。人気（like）とは別軸。
 */
import { prisma } from "@/lib/prisma";

const VERIFIED_VERDICTS = new Set(["TRUE", "REPORTED", "DISPUTED"]);

export interface UserTrustScore {
  /** FC を実行したコメント数 */
  checkedCount: number;
  /** TRUE / REPORTED / DISPUTED の件数 */
  verifiedCount: number;
  /** verifiedCount / checkedCount（0〜100）。未チェックなら null */
  passRate: number | null;
}

/** ユーザーの FC 通過率を集計する */
export async function getUserTrustScore(userId: string): Promise<UserTrustScore> {
  const rows = await prisma.comment.findMany({
    where: { userId, isHidden: false, fcCache: { isNot: null } },
    select: { fcCache: { select: { verdict: true } } },
  });

  const checkedCount = rows.length;
  if (checkedCount === 0) {
    return { checkedCount: 0, verifiedCount: 0, passRate: null };
  }

  const verifiedCount = rows.filter((r) =>
    r.fcCache && VERIFIED_VERDICTS.has(r.fcCache.verdict),
  ).length;

  return {
    checkedCount,
    verifiedCount,
    passRate: Math.round((verifiedCount / checkedCount) * 1000) / 10,
  };
}
