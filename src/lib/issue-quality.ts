/**
 * 争点の品質報告パイプライン（sybil攻撃耐性を持たせた設計）。
 *
 * 素朴な「N人が報告したら即非表示」は複数アカウントを作れば誰でもトレンド争点を
 * 機能不全にできてしまう。以下の3層で耐性を持たせる:
 *
 *   1. 報告できる人を絞る（新規24h未満のアカウント不可・その争点に投票/コメントした人のみ）
 *      → sybilアカウント1つ作るごとに投票という別のコストを払わせる
 *   2. 閾値を争点の投票者数に比例させる（人気争点ほど多くの報告が必要）
 *      → バズった争点を少数のsybilで沈黙させることを防ぐ
 *   3. 閾値到達時、即座に隠さずAIが報告内容の妥当性を裏取りしてから隠す
 *      → 理由なし・組織的に見える報告パターンはAIが見抜いて隠さない
 *      → ただしAIも欺かれた場合の保険として、閾値の3倍に達したら無条件でunderReview
 */
import { prisma } from "@/lib/prisma";
import { judgeIssueQuality } from "@/lib/ai";
import { invalidateOnIssueChanged, invalidateOnTimelineUpdated } from "@/lib/cache-invalidate";
import { RADAR, MODERATION } from "@/lib/constants";

export type QualityReportOutcome =
  | { ok: true; recorded: true; underReview: boolean }
  | { ok: false; status: 403; message: string };

/** 報告資格チェック: アカウント年齢 + その争点への関与（投票 or コメント） */
export async function canReportQuality(
  userId: string,
  userCreatedAt: Date,
  issueId: string,
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  const accountAgeMs = Date.now() - userCreatedAt.getTime();
  if (accountAgeMs < MODERATION.newAccountCommentHours * 3600_000) {
    return {
      allowed: false,
      message: `アカウント作成から${MODERATION.newAccountCommentHours}時間は品質報告できません`,
    };
  }

  const [vote, comment] = await Promise.all([
    prisma.vote.findUnique({ where: { userId_issueId: { userId, issueId } }, select: { id: true } }),
    prisma.comment.findFirst({ where: { userId, issueId }, select: { id: true } }),
  ]);
  if (!vote && !comment) {
    return {
      allowed: false,
      message: "この争点に投票またはコメントしたユーザーのみ品質報告できます",
    };
  }
  return { allowed: true };
}

/** 現在の投票者数に応じた必要報告数（人気争点ほど多く必要） */
async function requiredThreshold(issueId: string): Promise<number> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { voteForCount: true, voteAgainstCount: true, voteUndecidedCount: true },
  });
  const voters = issue
    ? issue.voteForCount + issue.voteAgainstCount + issue.voteUndecidedCount
    : 0;
  return Math.max(
    RADAR.qualityReportThreshold,
    Math.ceil(voters * RADAR.qualityReportVoterRatio),
  );
}

/**
 * 報告記録後に呼ぶ。閾値未達なら何もしない。閾値到達でAI裏取り→妥当ならunderReview。
 * 閾値の3倍（ハード上限）に達したらAI結果に関わらずunderReview化（AI回避策への保険）。
 */
export async function evaluateQualityReports(issueId: string): Promise<boolean> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { id: true, slug: true, underReview: true, summaryJson: true },
  });
  if (!issue || issue.underReview) return issue?.underReview ?? false;

  const reports = await prisma.issueQualityReport.findMany({
    where: { issueId },
    select: { reason: true },
  });
  const threshold = await requiredThreshold(issueId);
  if (reports.length < threshold) return false;

  const hardLimit = threshold * RADAR.qualityReportHardMultiplier;
  let shouldHide = reports.length >= hardLimit;
  let aiNote = "";

  if (!shouldHide) {
    try {
      const lead = (issue.summaryJson as { lead?: string })?.lead ?? "";
      const judgement = await judgeIssueQuality(
        lead,
        reports.map((r) => r.reason ?? ""),
      );
      shouldHide = judgement.credible && judgement.confidence >= MODERATION.aiConfidenceThreshold;
      aiNote = ` AI判定: credible=${judgement.credible} confidence=${judgement.confidence.toFixed(2)} — ${judgement.reason}`;
    } catch (e) {
      // AI障害時は隠さない（sybilに悪用されにくい安全側＝可用性優先）。次の報告時に再評価される
      console.error("[issue-quality] ai judge failed", e);
      return false;
    }
  }

  if (!shouldHide) return false;

  await prisma.$transaction([
    prisma.issue.update({ where: { id: issueId }, data: { underReview: true } }),
    prisma.issueTimeline.create({
      data: {
        issueId,
        label: `品質報告${reports.length}件（必要数${threshold}）により人間確認待ちになりました。${aiNote}`,
      },
    }),
  ]);
  void invalidateOnTimelineUpdated(issueId, issue.slug);
  void invalidateOnIssueChanged(issue.slug);
  return true;
}
