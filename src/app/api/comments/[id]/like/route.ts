import { NextResponse, type NextRequest } from "next/server";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { kv } from "@/lib/redis";

export const runtime = "nodejs";

/**
 * 「共感」— 無料ログインユーザーも可。
 * 重複防止はKVマーカー（テーブル追加なしの軽量実装。KV消失時の重複は許容）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { id: commentId } = await params;
  const userId = session.user.id;

  const ok = await checkRateLimit("like", userId, 60, 60);
  if (!ok) return errors.rateLimited();

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, likeCount: true },
  });
  if (!comment) return errors.notFound("コメントが見つかりません");

  const marker = `like:${commentId}:${userId}`;
  const already = await kv.get(marker);
  if (already) {
    return NextResponse.json({ likeCount: comment.likeCount });
  }

  await kv.set(marker, "1", { ex: 60 * 60 * 24 * 365 });
  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { likeCount: { increment: 1 } },
    select: { likeCount: true },
  });
  return NextResponse.json({ likeCount: updated.likeCount });
}
