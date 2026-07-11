import { NextResponse, type NextRequest } from "next/server";
import { requireSession, checkRateLimit, errors, apiError } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { factCheck } from "@/lib/ai";
import { retrieveChunks } from "@/lib/rag";
import { invalidateOnFcResultSaved } from "@/lib/cache-invalidate";
import { consumeFcQuota } from "@/lib/fc-quota";
import { acquireFcInflightSlot, releaseFcInflightSlot } from "@/lib/fc-inflight";
import { canUseFactCheck, fcDailyLimit } from "@/lib/plan-features";
import { buildSourceLinks } from "@/lib/fc-sources";
import type { FcVerdict, Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * ワンタップFC。Plus 5回/日、Pro 20回/日。
 *   **キャッシュヒットでも1回分消費する**（運営コストはキャッシュヒットで¥0になるが、
 *   閲覧の「回数」自体をユーザーの体験としてカウントする方が意図がわかりやすいため）
 * - 判定は6カテゴリ + 表示ラベル + 必ず出典リンク
 * - 同一コメントのAI呼び出し結果は全ユーザー共有キャッシュ（2人目以降のAIコストは¥0）
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const plan = session.user.plan;
  if (!canUseFactCheck(plan)) {
    return errors.forbidden("ワンタップファクトチェックはPlus / Proプラン限定の機能です");
  }

  const dailyLimit = fcDailyLimit(plan);

  const { id: commentId } = await params;

  const burst = await checkRateLimit("factcheck", session.user.id, 10, 60);
  if (!burst) return errors.rateLimited();

  // クォータはキャッシュヒットかどうかに関わらず先に消費する
  const quota = await consumeFcQuota(session.user.id, plan);
  if (!quota.allowed) {
    return apiError(
      429,
      `本日のファクトチェック回数（${dailyLimit}回）を使い切りました。明日リセットされます`,
      "FC_QUOTA_EXCEEDED",
    );
  }

  const cached = await prisma.fcCache.findUnique({ where: { commentId } });
  if (cached) {
    return NextResponse.json(
      toResponse(cached.verdict, cached.label, cached.reason, cached.sourceUrls, cached.createdAt, true, quota.remaining),
    );
  }

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, body: true, issueId: true },
  });
  if (!comment) return errors.notFound("コメントが見つかりません");

  // pgvector類似検索（コメント内容に最も関連する根拠を選ぶ）。失敗時はリンク順フォールバック
  const chunks = await retrieveChunks(comment.issueId, comment.body, 3);

  const inflightOk = await acquireFcInflightSlot();
  if (!inflightOk) {
    return NextResponse.json(
      {
        error: {
          message: "ファクトチェックが混み合っています。しばらく待ってからお試しください",
          code: "FC_BUSY",
        },
      },
      { status: 503 },
    );
  }

  try {
    const result = await factCheck(comment.body, chunks);
    const sourceUrls = buildSourceLinks(result.sourceIds, chunks);

    // 並行リクエストでの重複作成はunique制約で片方が失敗→既存を返す
    try {
      const saved = await prisma.fcCache.create({
        data: {
          commentId,
          verdict: result.verdict,
          label: result.label,
          reason: result.reason,
          sourceIds: result.sourceIds,
          sourceUrls: sourceUrls as unknown as Prisma.InputJsonValue,
          resultJson: {
            v: result.verdict,
            l: result.label,
            r: result.reason,
            s: result.sourceIds,
          },
        },
      });
      void invalidateOnFcResultSaved(comment.issueId);
      return NextResponse.json(
        toResponse(saved.verdict, saved.label, saved.reason, saved.sourceUrls, saved.createdAt, false, quota.remaining),
      );
    } catch {
      const existing = await prisma.fcCache.findUnique({ where: { commentId } });
      if (existing) {
        return NextResponse.json(
          toResponse(existing.verdict, existing.label, existing.reason, existing.sourceUrls, existing.createdAt, true, quota.remaining),
        );
      }
      throw new Error("fc cache save failed");
    }
  } catch (e) {
    console.error("[factcheck] failed", e);
    return NextResponse.json(
      {
        error: {
          message: "ファクトチェックが混み合っています。しばらく待ってからお試しください",
          code: "FC_UNAVAILABLE",
        },
      },
      { status: 503 },
    );
  } finally {
    await releaseFcInflightSlot();
  }
}

function toResponse(
  verdict: FcVerdict,
  label: string | null,
  reason: string,
  sourceUrls: unknown,
  checkedAt: Date,
  cached: boolean,
  remaining: number,
) {
  return {
    verdict: verdict.toLowerCase(),
    label,
    reason,
    sources: Array.isArray(sourceUrls) ? sourceUrls : [],
    checkedAt: checkedAt.toISOString(),
    cached,
    remaining,
  };
}
