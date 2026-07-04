/**
 * モデレーション状態機械。
 *
 * VISIBLE --(通報3件)--> AUTO_HIDDEN --(AI違反・確度≥0.8)--> REMOVED_AI --(異議申立)--> 人間判断
 *                                   --(AI問題なし・確度≥0.8)--> AI_CLEARED（復帰・以後の自動非表示なし）
 *                                   --(確度<0.8)--> HUMAN_REVIEW（非表示のまま人間キュー）
 * AI_CLEARED --(さらに通報3件)--> HUMAN_REVIEW（表示は維持・AIには再判定させない）
 *
 * 「9割はAIが自動処理、迷った1割と異議申立は必ず人間」を構造で保証する。
 */
import { prisma } from "@/lib/prisma";
import { judgeModeration, type ModerationJudgement } from "@/lib/ai";
import { MODERATION } from "@/lib/constants";
import type { ModerationStatus } from "@prisma/client";

export interface PipelineResult {
  status: ModerationStatus;
  action:
    | "none" // 閾値未達
    | "auto_removed" // AIが違反確定
    | "auto_cleared" // AIが問題なし→復帰
    | "queued_human" // 人間キュー行き
    | "already_handled";
  aiVerdict?: ModerationJudgement;
}

const HIDDEN_STATUSES: ModerationStatus[] = [
  "AUTO_HIDDEN",
  "REMOVED_AI",
  "REMOVED_HUMAN",
  "HUMAN_REVIEW",
];

export function isHiddenStatus(status: ModerationStatus): boolean {
  return HIDDEN_STATUSES.includes(status);
}

/** 通報受付後に呼ばれる。閾値判定→AI判定→状態遷移まで一括で行う。 */
export async function processReports(commentId: string): Promise<PipelineResult> {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      body: true,
      moderationStatus: true,
      reports: { select: { reporterId: true, reason: true, resolved: true } },
    },
  });
  if (!comment) return { status: "VISIBLE", action: "already_handled" };

  const status = comment.moderationStatus;

  // 削除確定済み・人間キュー済みは何もしない
  if (status === "REMOVED_AI" || status === "REMOVED_HUMAN" || status === "HUMAN_REVIEW") {
    return { status, action: "already_handled" };
  }

  const distinctReporters = new Set(comment.reports.map((r) => r.reporterId)).size;
  if (distinctReporters < MODERATION.reportAutoHideThreshold) {
    return { status, action: "none" };
  }

  // AI_CLEARED後の再通報: AIに再判定させず人間へ（AI判定の堂々巡りを防ぐ。表示は維持）
  if (status === "AI_CLEARED") {
    const unresolved = comment.reports.filter((r) => !r.resolved).length;
    if (unresolved >= MODERATION.reportAutoHideThreshold) {
      await prisma.$transaction([
        prisma.comment.update({
          where: { id: commentId },
          data: { moderationStatus: "HUMAN_REVIEW", isHidden: true },
        }),
        prisma.moderationCase.create({
          data: { commentId, source: "reports", aiVerdict: { note: "AI_CLEARED後の再通報" } },
        }),
      ]);
      return { status: "HUMAN_REVIEW", action: "queued_human" };
    }
    return { status, action: "none" };
  }

  // 閾値到達: まず即時非表示（誹謗中傷の露出時間を最小化）
  if (status === "VISIBLE") {
    await prisma.comment.update({
      where: { id: commentId },
      data: { moderationStatus: "AUTO_HIDDEN", isHidden: true },
    });
  }

  // AIチェックリスト判定
  let verdict: ModerationJudgement;
  try {
    verdict = await judgeModeration(
      comment.body,
      comment.reports.map((r) => r.reason ?? ""),
    );
  } catch (e) {
    // AI障害: 非表示のまま人間キューへ（安全側に倒す）
    console.error("[moderation] ai judge failed", e);
    await prisma.moderationCase.create({
      data: { commentId, source: "reports", aiVerdict: { error: "ai_unavailable" } },
    });
    return { status: "HUMAN_REVIEW", action: "queued_human" };
  }

  const confident = verdict.confidence >= MODERATION.aiConfidenceThreshold;

  if (confident && verdict.violation) {
    // 違反確定: 非表示のまま確定。通報を解決済みに
    await prisma.$transaction([
      prisma.comment.update({
        where: { id: commentId },
        data: { moderationStatus: "REMOVED_AI", isHidden: true },
      }),
      prisma.report.updateMany({ where: { commentId }, data: { resolved: true } }),
    ]);
    return { status: "REMOVED_AI", action: "auto_removed", aiVerdict: verdict };
  }

  if (confident && !verdict.violation) {
    // 問題なし: 復帰。以後は自動非表示しない（AI_CLEARED）
    await prisma.$transaction([
      prisma.comment.update({
        where: { id: commentId },
        data: { moderationStatus: "AI_CLEARED", isHidden: false },
      }),
      prisma.report.updateMany({ where: { commentId }, data: { resolved: true } }),
    ]);
    return { status: "AI_CLEARED", action: "auto_cleared", aiVerdict: verdict };
  }

  // 確度不足: 非表示のまま人間キュー
  await prisma.$transaction([
    prisma.comment.update({
      where: { id: commentId },
      data: { moderationStatus: "HUMAN_REVIEW", isHidden: true },
    }),
    prisma.moderationCase.create({
      data: {
        commentId,
        source: "reports",
        aiVerdict: {
          violation: verdict.violation,
          category: verdict.category,
          confidence: verdict.confidence,
          reason: verdict.reason,
        },
      },
    }),
  ]);
  return { status: "HUMAN_REVIEW", action: "queued_human", aiVerdict: verdict };
}
