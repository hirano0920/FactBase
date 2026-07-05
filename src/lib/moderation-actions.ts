/**
 * 人間モデレーション操作（CLI・管理ダッシュボード共通）。
 */
import { prisma } from "@/lib/prisma";
import { invalidateOnCommentCreated, invalidateOnIssueChanged } from "@/lib/cache-invalidate";

export type ModerationResolution =
  | "removed"
  | "restored"
  | "appeal_accepted"
  | "appeal_rejected";

export type IssueAdminAction = "clear" | "archive" | "unpublish" | "restore";

export async function listPendingModerationCases() {
  return prisma.moderationCase.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: {
      comment: {
        select: {
          id: true,
          body: true,
          moderationStatus: true,
          createdAt: true,
          issue: { select: { slug: true, title: true } },
          user: { select: { name: true, email: true } },
          appeal: { select: { reason: true, status: true, createdAt: true } },
          reports: {
            select: { reason: true, createdAt: true, reporter: { select: { name: true, email: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });
}

export async function resolveModerationCase(caseId: string, resolution: ModerationResolution) {
  const kase = await prisma.moderationCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      commentId: true,
      source: true,
      status: true,
      comment: { select: { issue: { select: { slug: true, id: true } } } },
    },
  });
  if (!kase) throw new Error("ケースが見つかりません");
  if (kase.status !== "PENDING") throw new Error("既に処理済みです");

  const commentUpdate =
    resolution === "removed" || resolution === "appeal_rejected"
      ? { moderationStatus: "REMOVED_HUMAN" as const, isHidden: true }
      : { moderationStatus: "AI_CLEARED" as const, isHidden: false };

  await prisma.$transaction([
    prisma.moderationCase.update({
      where: { id: caseId },
      data: { status: "RESOLVED", resolution, resolvedAt: new Date() },
    }),
    prisma.comment.update({ where: { id: kase.commentId }, data: commentUpdate }),
    prisma.report.updateMany({ where: { commentId: kase.commentId }, data: { resolved: true } }),
    ...(kase.source === "appeal"
      ? [
          prisma.appeal.update({
            where: { commentId: kase.commentId },
            data: {
              status: resolution === "appeal_accepted" ? "ACCEPTED" : "REJECTED",
              resolvedAt: new Date(),
            },
          }),
        ]
      : []),
  ]);

  const slug = kase.comment.issue.slug;
  await invalidateOnCommentCreated(kase.comment.issue.id, slug);
  return { caseId, resolution, slug };
}

export async function listFlaggedIssues() {
  return prisma.issue.findMany({
    where: { underReview: true },
    orderBy: { updatedAt: "desc" },
    include: {
      qualityReports: {
        select: {
          reason: true,
          createdAt: true,
          reporter: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function listRecentRadarIssues(limit = 30) {
  return prisma.issue.findMany({
    where: {
      confirmation: { not: "MANUAL" },
      status: { not: "ARCHIVED" },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      confirmation: true,
      underReview: true,
      createdAt: true,
      summaryJson: true,
      _count: { select: { qualityReports: true, comments: true } },
    },
  });
}

export async function listHeldRadarCandidates(limit = 20) {
  return prisma.topicCandidate.findMany({
    where: { status: "HELD" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** cronは15分間隔で動く前提。この分数を超えて新規イベントが来ていなければ停止を疑う */
const RADAR_STALE_MINUTES = 40;

/**
 * 「今日ニュースが少なくて記事が出ていない」のか「パイプライン自体が止まっている」のかを
 * 判別するための稼働状況。Slack Webhook未設定でも管理画面だけで判断できるようにする。
 * lastSourceEventAtが更新され続けていればdetect.tsのフィード取得は生きている
 * （＝新着0件でも公開0件でも「動いてはいる」と判断できる）。
 */
export async function getRadarHealth() {
  const [lastSourceEvent, lastCandidate, todayIssueCount, todayCandidateCount] = await Promise.all([
    prisma.sourceEvent.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.topicCandidate.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    prisma.issue.count({
      where: {
        confirmation: { in: ["OFFICIAL", "REPORTED"] },
        createdAt: { gte: new Date(new Date().toISOString().slice(0, 10)) },
      },
    }),
    prisma.topicCandidate.count({
      where: { createdAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
    }),
  ]);

  const minutesSinceLastEvent = lastSourceEvent
    ? (Date.now() - lastSourceEvent.createdAt.getTime()) / 60_000
    : null;
  // フィード取得（detect.tsのステップ1）が動いていれば必ず定期的にSourceEventが増える。
  // これが止まっていればcron自体が停止/クラッシュしている可能性が高い
  const alive = minutesSinceLastEvent !== null && minutesSinceLastEvent <= RADAR_STALE_MINUTES;

  return {
    alive,
    lastSourceEventAt: lastSourceEvent?.createdAt.toISOString() ?? null,
    lastCandidateEvaluatedAt: lastCandidate?.updatedAt.toISOString() ?? null,
    minutesSinceLastEvent: minutesSinceLastEvent !== null ? Math.round(minutesSinceLastEvent) : null,
    todayIssueCount,
    todayCandidateCount,
  };
}

export async function listUnresolvedReports(limit = 30) {
  return prisma.report.findMany({
    where: { resolved: false },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      comment: {
        select: {
          id: true,
          body: true,
          moderationStatus: true,
          issue: { select: { slug: true, title: true } },
        },
      },
      reporter: { select: { name: true, email: true } },
    },
  });
}

export async function resolveIssueAdmin(slug: string, action: IssueAdminAction) {
  const issue = await prisma.issue.findUnique({
    where: { slug },
    select: { id: true, slug: true, underReview: true, status: true },
  });
  if (!issue) throw new Error("争点が見つかりません");

  let data: { underReview?: boolean; status?: "ACTIVE" | "TRENDING" | "ARCHIVED" } = {};
  let timelineLabel: string;

  switch (action) {
    case "clear":
      if (!issue.underReview) throw new Error("この争点は確認待ちではありません");
      data = { underReview: false };
      timelineLabel = "管理者確認完了。通常表示に復帰しました";
      break;
    case "archive":
      data = { underReview: false, status: "ARCHIVED" };
      timelineLabel = "管理者が品質不良と判断しアーカイブしました";
      break;
    case "unpublish":
      data = { underReview: false, status: "ARCHIVED" };
      timelineLabel = "管理者が非公開（アーカイブ）にしました";
      break;
    case "restore":
      if (issue.status !== "ARCHIVED") throw new Error("アーカイブ済みの争点のみ復帰できます");
      data = { underReview: false, status: "TRENDING" };
      timelineLabel = "管理者が公開に復帰させました";
      break;
    default:
      throw new Error("不明な操作です");
  }

  await prisma.$transaction([
    prisma.issue.update({ where: { id: issue.id }, data }),
    prisma.issueTimeline.create({
      data: { issueId: issue.id, label: timelineLabel },
    }),
  ]);

  await invalidateOnIssueChanged(slug);
  return { slug, action };
}

export async function rejectRadarCandidate(candidateId: string) {
  const c = await prisma.topicCandidate.findUnique({
    where: { id: candidateId },
    select: { id: true, status: true },
  });
  if (!c) throw new Error("候補が見つかりません");
  if (c.status !== "HELD") throw new Error("HELD状態の候補のみ却下できます");
  await prisma.topicCandidate.update({
    where: { id: candidateId },
    data: { status: "REJECTED", decision: "admin_rejected" },
  });
  return { candidateId };
}

/**
 * HELD候補の人間承認→即公開。
 * ハードブロック（一般人個人名・性犯罪等）や日次上限でHELDになった候補を
 * 管理者が確認したうえで争点として公開する（従来は却下しか手段がなく、
 * 上限到達後に来た重要トピックが永久に埋もれていた）。
 */
export async function approveRadarCandidate(candidateId: string) {
  const c = await prisma.topicCandidate.findUnique({ where: { id: candidateId } });
  if (!c) throw new Error("候補が見つかりません");
  if (c.status !== "HELD") throw new Error("HELD状態の候補のみ承認できます");

  const sources = (c.sourceUrls as { title: string; url: string; feed: string }[] | null) ?? [];
  const confirmation = c.classification === "official" || c.classification === "indicator"
    ? ("OFFICIAL" as const)
    : ("REPORTED" as const);
  const categoryMap: Record<string, "POLITICS" | "ECONOMY" | "LAW" | "FINANCE" | "EDUCATION"> = {
    politics: "POLITICS",
    economy: "ECONOMY",
    law: "LAW",
    finance: "FINANCE",
    education: "EDUCATION",
  };

  const slug = `radar-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
  const issue = await prisma.issue.create({
    data: {
      slug,
      title: c.title,
      category: categoryMap[c.category ?? ""] ?? "POLITICS",
      status: "TRENDING",
      confirmation,
      summaryJson: {
        lead: `「${c.title}」について管理者確認のうえ公開されました。詳細まとめを自動生成中です。`,
        bullets: [
          `確認できること: ${sources.length}件の報道・発表（下記出典）`,
          "詳細まとめを自動生成中（10〜30分）",
          "続報・関連動向はタイムラインで更新されます",
        ],
        sources: sources.slice(0, 5).map((s) => ({
          label: `${s.title.slice(0, 40)}（${s.feed}）`,
          url: s.url,
        })),
      },
      keywords: [c.title],
      monitoringUntil: new Date(Date.now() + 60 * 86400_000),
    },
  });
  await prisma.$transaction([
    prisma.topicCandidate.update({
      where: { id: candidateId },
      data: { status: "PUBLISHED", issueId: issue.id, decision: `${c.decision ?? ""} / admin_approved` },
    }),
    prisma.issueTimeline.create({
      data: { issueId: issue.id, label: "管理者承認により公開（人間確認済み）" },
    }),
  ]);
  await invalidateOnIssueChanged(slug);
  return { candidateId, slug };
}
