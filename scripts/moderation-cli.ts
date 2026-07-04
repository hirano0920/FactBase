/**
 * 人間モデレーター用CLI（管理ダッシュボード /api/admin/* と同じロジック）。
 */
import {
  listFlaggedIssues,
  listPendingModerationCases,
  resolveIssueAdmin,
  resolveModerationCase,
  type ModerationResolution,
} from "../src/lib/moderation-actions";

async function list() {
  const cases = await listPendingModerationCases();
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

async function resolve(caseId: string, resolution: ModerationResolution) {
  await resolveModerationCase(caseId, resolution);
  console.log(`✅ ${caseId} → ${resolution}`);
}

async function listIssues() {
  const issues = await listFlaggedIssues();
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
      await listIssues();
      break;
    case "issue-clear":
      await resolveIssueAdmin(arg, "clear");
      console.log(`✅ ${arg} → clear`);
      break;
    case "issue-archive":
      await resolveIssueAdmin(arg, "archive");
      console.log(`✅ ${arg} → archive`);
      break;
    case "issue-unpublish":
      await resolveIssueAdmin(arg, "unpublish");
      console.log(`✅ ${arg} → unpublish`);
      break;
    default:
      console.log(
        "使い方: list | remove <caseId> | restore <caseId> | accept-appeal <caseId> | reject-appeal <caseId> | issues | issue-clear <slug> | issue-archive <slug> | issue-unpublish <slug>",
      );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
