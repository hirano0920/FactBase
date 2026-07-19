/**
 * サイト内続報通知（ブックマーク/投票した争点に新しいタイムライン更新があったら知らせる）。
 * プッシュ通知やメールではなく、ヘッダーのバッジ＋ドロップダウンだけの軽量な仕組み。
 */
import { prisma } from "@/lib/prisma";
import { getVoteSwing } from "@/lib/vote-swing";

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

  const items: NotificationItem[] = rows.map((r) => ({
    issueId: r.issueId,
    slug: r.issue.slug,
    title: r.issue.title,
    label: r.label,
    at: r.at.toISOString(),
  }));

  // ★常設debateのフォロー通知: 続報が無い争点でも、中立層のスイングが有意に動いていれば
  // 「対立の結果でなく説得の過程を商品化する」コアメカニクスの一部として知らせる。
  // 続報の方が情報として濃いため、同じ争点で両方あれば続報を優先し重複させない。
  const coveredIssueIds = new Set(items.map((i) => i.issueId));
  const swingCandidateIds = issueIds.filter((id) => !coveredIssueIds.has(id));
  if (swingCandidateIds.length > 0 && items.length < limit) {
    const swingIssues = await prisma.issue.findMany({
      where: { id: { in: swingCandidateIds } },
      select: { id: true, slug: true, title: true },
    });
    const swingResults = await Promise.all(
      swingIssues.map(async (issue) => ({ issue, swing: await getVoteSwing(issue.id) })),
    );
    for (const { issue, swing } of swingResults) {
      if (items.length >= limit) break;
      if (!swing) continue;
      const leader: "for" | "against" | null =
        swing.deltaPoints.for > swing.deltaPoints.against
          ? "for"
          : swing.deltaPoints.against > swing.deltaPoints.for
            ? "against"
            : null;
      if (!leader) continue;
      const delta = Math.abs(swing.deltaPoints[leader]);
      if (delta < 0.5) continue;
      items.push({
        issueId: issue.id,
        slug: issue.slug,
        title: issue.title,
        label: `中立層が動いています（${leader === "for" ? "賛成" : "反対"}+${delta}pt / 直近${swing.hoursAgo}時間）`,
        at: new Date().toISOString(),
      });
    }
  }

  return { items };
}

export async function markNotificationsSeen(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { notificationsCheckedAt: new Date() },
  });
}
