import { NextResponse, type NextRequest } from "next/server";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { awardHelpful } from "@/lib/badges";

export const runtime = "nodejs";

/** 「役に立った」— 1ユーザー1回（Helpfulテーブルでユニーク保証）。称号の材料。 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { id: commentId } = await params;
  const userId = session.user.id;

  const ok = await checkRateLimit("helpful", userId, 30, 60);
  if (!ok) return errors.rateLimited();

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, userId: true, issue: { select: { category: true } } },
  });
  if (!comment) return errors.notFound("コメントが見つかりません");

  let created = false;
  try {
    await prisma.$transaction([
      prisma.helpful.create({ data: { userId, commentId } }),
      prisma.comment.update({
        where: { id: commentId },
        data: { helpfulCount: { increment: 1 } },
      }),
    ]);
    created = true;
  } catch {
    // ユニーク制約違反 = 既に押している。冪等に成功として返す（称号は二重加算しない）
  }

  if (created) {
    try {
      await awardHelpful(comment.userId, comment.issue.category);
    } catch (e) {
      // 称号更新の失敗でユーザー操作自体は失敗させない
      console.error("[helpful] badge update failed", e);
    }
  }

  const updated = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { helpfulCount: true },
  });
  return NextResponse.json({ helpfulCount: updated?.helpfulCount ?? 0 });
}
