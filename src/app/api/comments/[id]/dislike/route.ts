import { NextResponse, type NextRequest } from "next/server";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { kv } from "@/lib/redis";

export const runtime = "nodejs";

/** dislike — likeと同じKVマーカー方式。カウント表示のみで並び順には使わない（算法なし方針） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { id: commentId } = await params;
  const userId = session.user.id;

  const ok = await checkRateLimit("dislike", userId, 60, 60);
  if (!ok) return errors.rateLimited();

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, dislikeCount: true },
  });
  if (!comment) return errors.notFound("コメントが見つかりません");

  const marker = `dislike:${commentId}:${userId}`;
  const already = await kv.get(marker);
  if (already) {
    return NextResponse.json({ dislikeCount: comment.dislikeCount });
  }

  await kv.set(marker, "1", { ex: 60 * 60 * 24 * 365 });
  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { dislikeCount: { increment: 1 } },
    select: { dislikeCount: true },
  });
  return NextResponse.json({ dislikeCount: updated.dislikeCount });
}
