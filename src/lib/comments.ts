import { prisma } from "@/lib/prisma";
import { moderateOnSubmit, type ModerationResult } from "@/lib/moderation";
import { COMMENT_LIMITS, MODERATION, REPLY_LIMITS } from "@/lib/constants";
import { choiceToEnum } from "@/lib/votes";
import type { VoteChoice } from "@prisma/client";
import type { VoteChoiceId } from "@/lib/constants";

export type CreateCommentResult =
  | { ok: true; commentId: string; hidden: boolean }
  | { ok: false; status: 403 | 422; message: string };

const normalize = (body: string) => body.trim().toLowerCase().replace(/\s+/g, "");

/**
 * コメント作成。送信時フィルタ → 24h新規制限 → 協調投稿検知 → 保存。
 * 同文面が同一争点に4件以上あれば isHidden=true で保存（投稿者にはエラーを見せない＝shadow hide）。
 * parentIdがあれば返信（1階層のみ）として扱い、スタンスは親コメントを引き継ぐ。
 */
export async function createComment(params: {
  userId: string;
  userCreatedAt: Date;
  issueId: string;
  stance: VoteChoiceId;
  body: string;
  parentId?: string;
}): Promise<CreateCommentResult> {
  const { userId, userCreatedAt, issueId, stance, body, parentId } = params;

  const moderation: ModerationResult = moderateOnSubmit(
    body,
    parentId ? REPLY_LIMITS : COMMENT_LIMITS,
  );
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

  let parent: { id: string; parentId: string | null; stance: VoteChoice } | null = null;
  if (parentId) {
    const parentRow = await prisma.comment.findUnique({
      where: { id: parentId },
      select: { id: true, issueId: true, parentId: true, stance: true, isHidden: true },
    });
    if (!parentRow || parentRow.issueId !== issueId || parentRow.isHidden) {
      return { ok: false, status: 422, message: "返信先のコメントが見つかりません" };
    }
    if (parentRow.parentId) {
      return { ok: false, status: 422, message: "返信への返信はできません" };
    }
    parent = parentRow;
  }

  const lastOwn = await prisma.comment.findFirst({
    where: { userId, issueId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (lastOwn) {
    const elapsedSec = (Date.now() - lastOwn.createdAt.getTime()) / 1000;
    if (elapsedSec < COMMENT_LIMITS.sameThreadCooldownSec) {
      const waitSec = Math.ceil(COMMENT_LIMITS.sameThreadCooldownSec - elapsedSec);
      return {
        ok: false,
        status: 422,
        message: `同一スレッドへの連投は${COMMENT_LIMITS.sameThreadCooldownSec}秒に1回までです。あと${waitSec}秒お待ちください`,
      };
    }
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
        // 返信は親コメントのスタンスを引き継ぐ（賛成/反対を別途選ばせない＝会話の続きとして扱う）
        stance: parent ? parent.stance : choiceToEnum[stance],
        parentId: parent?.id,
        body: body.trim(),
        isHidden: hidden,
      },
      select: { id: true },
    }),
    prisma.issue.update({
      where: { id: issueId },
      data: { commentCount: { increment: hidden ? 0 : 1 } },
    }),
    ...(parent && !hidden
      ? [
          prisma.comment.update({
            where: { id: parent.id },
            data: { replyCount: { increment: 1 } },
          }),
        ]
      : []),
  ]);

  return { ok: true, commentId: comment.id, hidden };
}
