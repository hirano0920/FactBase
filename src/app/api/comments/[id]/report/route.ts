import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { processReports } from "@/lib/moderation-pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

const reportSchema = z.object({
  reason: z.string().max(200).optional(),
});

/**
 * 「不適切なコメント」ボタン。
 * 別ユーザー3人が押すと自動非表示→AIチェックリスト判定→9割自動処理・1割人間キュー。
 * 通報者には常に同じ応答を返す（判定結果を漏らさない＝通報の悪用防止）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { id: commentId } = await params;
  const userId = session.user.id;

  const ok = await checkRateLimit("report", userId, 10, 3600);
  if (!ok) return errors.rateLimited();

  const body = await req.json().catch(() => ({}));
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return errors.validation("通報理由は200字以内で入力してください");

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, userId: true },
  });
  if (!comment) return errors.notFound("コメントが見つかりません");
  if (comment.userId === userId) {
    return errors.validation("自分のコメントは通報できません");
  }

  // 同一ユーザーの重複通報は冪等（新しい行を作らない＝閾値の水増し防止）
  const existing = await prisma.report.findFirst({
    where: { commentId, reporterId: userId },
    select: { id: true },
  });
  if (!existing) {
    await prisma.report.create({
      data: { commentId, reporterId: userId, reason: parsed.data.reason },
    });
  }

  try {
    await processReports(commentId);
  } catch (e) {
    console.error("[report] pipeline failed", e);
    // 通報自体は記録済み。パイプライン失敗は次の通報時に再実行される
  }

  return NextResponse.json({ received: true });
}
