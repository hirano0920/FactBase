import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const appealSchema = z.object({
  reason: z.string().min(10).max(500),
});

/**
 * 削除への異議申立。本人のみ・1コメント1回。
 * 判断は必ず人間（ModerationCaseに積まれ、AIは関与しない）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { id: commentId } = await params;
  const userId = session.user.id;

  const ok = await checkRateLimit("appeal", userId, 5, 3600);
  if (!ok) return errors.rateLimited();

  const body = await req.json().catch(() => null);
  const parsed = appealSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validation("異議申立の理由を10字以上500字以内で入力してください");
  }

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, userId: true, moderationStatus: true, appeal: { select: { id: true } } },
  });
  if (!comment) return errors.notFound("コメントが見つかりません");
  if (comment.userId !== userId) {
    return errors.forbidden("本人のコメントのみ異議申立できます");
  }
  if (comment.moderationStatus !== "REMOVED_AI" && comment.moderationStatus !== "REMOVED_HUMAN") {
    return errors.validation("削除されたコメントのみ異議申立できます");
  }
  if (comment.appeal) {
    return errors.validation("このコメントには既に異議申立済みです");
  }

  await prisma.$transaction([
    prisma.appeal.create({
      data: { commentId, userId, reason: parsed.data.reason },
    }),
    prisma.moderationCase.create({
      data: { commentId, source: "appeal" },
    }),
  ]);

  return NextResponse.json({
    received: true,
    message: "異議申立を受け付けました。人間のモデレーターが確認します（AIは判断に関与しません）",
  });
}
