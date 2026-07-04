import { prisma } from "@/lib/prisma";
import { moderateOnSubmit, type ModerationResult } from "@/lib/moderation";
import { MODERATION } from "@/lib/constants";
import { choiceToEnum } from "@/lib/votes";
import type { VoteChoiceId } from "@/lib/constants";

export type CreateCommentResult =
  | { ok: true; commentId: string; hidden: boolean }
  | { ok: false; status: 403 | 422; message: string };

const normalize = (body: string) => body.trim().toLowerCase().replace(/\s+/g, "");

/**
 * コメント作成。送信時フィルタ → 24h新規制限 → 協調投稿検知 → 保存。
 * 同文面が同一争点に4件以上あれば isHidden=true で保存（投稿者にはエラーを見せない＝shadow hide）。
 */
export async function createComment(params: {
  userId: string;
  userCreatedAt: Date;
  issueId: string;
  stance: VoteChoiceId;
  body: string;
}): Promise<CreateCommentResult> {
  const { userId, userCreatedAt, issueId, stance, body } = params;

  const moderation: ModerationResult = moderateOnSubmit(body);
  if (!moderation.allowed) {
    return { ok: false, status: 422, message: moderation.reason };
  }

  const accountAgeMs = Date.now() - userCreatedAt.getTime();
  if (accountAgeMs < MODERATION.newAccountCommentHours * 3600_000) {
    return {
      ok: false,
      status: 403,
      message: `アカウント作成から${MODERATION.newAccountCommentHours}時間はコメントできません（荒らし対策）`,
    };
  }

  // 協調投稿検知: 直近24hの同争点コメントに同一文面が4件以上
  const since = new Date(Date.now() - 24 * 3600_000);
  const recent = await prisma.comment.findMany({
    where: { issueId, createdAt: { gte: since } },
    select: { body: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const normalizedBody = normalize(body);
  const sameCount = recent.filter((c) => normalize(c.body) === normalizedBody).length;
  const hidden = sameCount >= 4;

  const [comment] = await prisma.$transaction([
    prisma.comment.create({
      data: {
        userId,
        issueId,
        stance: choiceToEnum[stance],
        body: body.trim(),
        isHidden: hidden,
      },
      select: { id: true },
    }),
    prisma.issue.update({
      where: { id: issueId },
      data: { commentCount: { increment: hidden ? 0 : 1 } },
    }),
  ]);

  return { ok: true, commentId: comment.id, hidden };
}
