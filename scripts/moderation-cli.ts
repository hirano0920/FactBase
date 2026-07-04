/**
 * 人間モデレーター用CLI（残り1割の人間判断 + 異議申立の処理）。
 *
 * 使い方:
 *   npx tsx scripts/moderation-cli.ts list                     # 未処理キュー一覧
 *   npx tsx scripts/moderation-cli.ts remove <caseId> [理由]   # 削除確定
 *   npx tsx scripts/moderation-cli.ts restore <caseId>         # 復帰
 *   npx tsx scripts/moderation-cli.ts accept-appeal <caseId>   # 異議認容→コメント復帰
 *   npx tsx scripts/moderation-cli.ts reject-appeal <caseId>   # 異議棄却
 *
 *   npx tsx scripts/moderation-cli.ts issues                   # underReview中の争点一覧
 *   npx tsx scripts/moderation-cli.ts issue-clear <slug>        # 確認完了・通常表示に戻す
 *   npx tsx scripts/moderation-cli.ts issue-archive <slug>      # 品質不良でアーカイブ
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function list() {
  const cases = await prisma.moderationCase.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: {
      comment: {
        select: {
          body: true,
          moderationStatus: true,
          appeal: { select: { reason: true } },
          reports: { select: { reason: true } },
        },
      },
    },
  });

  if (cases.length === 0) {
    console.log("未処理のケースはありません 🎉");
    return;
  }

  for (const c of cases) {
    console.log("─".repeat(60));
    console.log(`caseId: ${c.id} [${c.source}] ${c.createdAt.toISOString()}`);
    console.log(`状態: ${c.comment.moderationStatus}`);
    console.log(`本文: ${c.comment.body.slice(0, 200)}`);
    if (c.aiVerdict) console.log(`AI参考判定: ${JSON.stringify(c.aiVerdict)}`);
    if (c.comment.appeal) console.log(`異議理由: ${c.comment.appeal.reason}`);
    const reasons = c.comment.reports.map((r) => r.reason).filter(Boolean);
    if (reasons.length) console.log(`通報理由: ${reasons.join(" / ")}`);
  }
  console.log("─".repeat(60));
  console.log(`計 ${cases.length} 件`);
}

async function resolve(
  caseId: string,
  resolution: "removed" | "restored" | "appeal_accepted" | "appeal_rejected",
) {
  const kase = await prisma.moderationCase.findUnique({
    where: { id: caseId },
    select: { id: true, commentId: true, source: true, status: true },
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
  console.log(`✅ ${caseId} → ${resolution}`);
}

async function listFlaggedIssues() {
  const issues = await prisma.issue.findMany({
    where: { underReview: true },
    include: {
      qualityReports: { select: { reason: true, createdAt: true } },
      timeline: { orderBy: { at: "desc" }, take: 3 },
    },
  });
  if (issues.length === 0) {
    console.log("人間確認待ちの争点はありません 🎉");
    return;
  }
  for (const issue of issues) {
    console.log("─".repeat(60));
    console.log(`slug: ${issue.slug}`);
    console.log(`タイトル: ${issue.title}`);
    console.log(`確認区分: ${issue.confirmation} / 品質報告: ${issue.qualityReports.length}件`);
    const lead = (issue.summaryJson as { lead?: string })?.lead;
    if (lead) console.log(`要約: ${lead}`);
    const reasons = issue.qualityReports.map((r) => r.reason).filter(Boolean);
    if (reasons.length) console.log(`報告理由: ${reasons.join(" / ")}`);
  }
  console.log("─".repeat(60));
  console.log(`計 ${issues.length} 件`);
}

async function resolveIssue(slug: string, action: "clear" | "archive") {
  const issue = await prisma.issue.findUnique({ where: { slug }, select: { id: true, underReview: true } });
  if (!issue) throw new Error("争点が見つかりません");
  if (!issue.underReview) throw new Error("この争点は確認待ちではありません");

  await prisma.$transaction([
    prisma.issue.update({
      where: { id: issue.id },
      data:
        action === "clear"
          ? { underReview: false }
          : { underReview: false, status: "ARCHIVED" },
    }),
    prisma.issueTimeline.create({
      data: {
        issueId: issue.id,
        label:
          action === "clear"
            ? "人間確認完了。通常表示に復帰しました"
            : "人間確認の結果、品質不良のためアーカイブしました",
      },
    }),
  ]);
  console.log(`✅ ${slug} → ${action}`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "list":
      await list();
      break;
    case "remove":
      await resolve(arg, "removed");
      break;
    case "restore":
      await resolve(arg, "restored");
      break;
    case "accept-appeal":
      await resolve(arg, "appeal_accepted");
      break;
    case "reject-appeal":
      await resolve(arg, "appeal_rejected");
      break;
    case "issues":
      await listFlaggedIssues();
      break;
    case "issue-clear":
      await resolveIssue(arg, "clear");
      break;
    case "issue-archive":
      await resolveIssue(arg, "archive");
      break;
    default:
      console.log(
        "使い方: list | remove <caseId> | restore <caseId> | accept-appeal <caseId> | reject-appeal <caseId> | issues | issue-clear <slug> | issue-archive <slug>",
      );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
