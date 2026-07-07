/**
 * サイト内続報通知（ブックマーク/投票した争点に新しいタイムライン更新があったら知らせる）。
 * プッシュ通知やメールではなく、ヘッダーのバッジ＋ドロップダウンだけの軽量な仕組み。
 */
import { prisma } from "@/lib/prisma";

export interface NotificationItem {
  issueId: string;
  slug: string;
  title: string;
  label: string;
  at: string;
}

export interface FollowedUpdates {
  items: NotificationItem[];
}

/**
 * ユーザーがブックマーク or 投票した争点のうち、前回確認以降にタイムライン更新（続報等）があったものを返す。
 * 1争点につき最新の更新1件のみ（バッジ件数=更新のあった争点数、という直感的な仕様にするため）。
 */
export async function getFollowedUpdates(userId: string, limit = 20): Promise<FollowedUpdates> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { createdAt: true, notificationsCheckedAt: true },
  });
  if (!user) return { items: [] };
  const cutoff = user.notificationsCheckedAt ?? user.createdAt;

  const [bookmarks, votes] = await Promise.all([
    prisma.bookmark.findMany({ where: { userId }, select: { issueId: true } }),
    prisma.vote.findMany({ where: { userId }, select: { issueId: true } }),
  ]);
  const issueIds = [...new Set([...bookmarks, ...votes].map((r) => r.issueId))];
  if (issueIds.length === 0) return { items: [] };

  const rows = await prisma.issueTimeline.findMany({
    where: { issueId: { in: issueIds }, at: { gt: cutoff } },
    orderBy: { at: "desc" },
    distinct: ["issueId"],
    take: limit,
    include: { issue: { select: { slug: true, title: true } } },
  });

  return {
    items: rows.map((r) => ({
      issueId: r.issueId,
      slug: r.issue.slug,
      title: r.issue.title,
      label: r.label,
      at: r.at.toISOString(),
    })),
  };
}

export async function markNotificationsSeen(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { notificationsCheckedAt: new Date() },
  });
}
