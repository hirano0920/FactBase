import { factCheck } from "@/lib/ai";
import { retrieveChunks } from "@/lib/rag";
import { consumeFcQuota } from "@/lib/fc-quota";
import { acquireFcInflightSlot, releaseFcInflightSlot } from "@/lib/fc-inflight";
import { canUseFactCheck, fcDailyLimit } from "@/lib/plan-features";
import { buildSourceLinks, type FcSourceLink } from "@/lib/fc-sources";
import type { Plan } from "@prisma/client";

export interface DraftFactCheckOk {
  ok: true;
  verdict: string;
  label: string | null;
  reason: string;
  sources: FcSourceLink[];
  remaining: number;
}

export interface DraftFactCheckError {
  ok: false;
  status: number;
  message: string;
  code: string;
}

export type DraftFactCheckResult = DraftFactCheckOk | DraftFactCheckError;

/**
 * 投稿前ファクトチェック（案B: ブロックしない）のコアロジック。
 * commentIdを持たない下書き本文に対して実行するため、FcCacheへの保存はしない
 * （本文はまだ確定していない＝編集される前提。同一クォータ枠はワンタップFCと共有する）。
 */
export async function checkDraftFactCheck(
  userId: string,
  plan: Plan,
  issueId: string,
  body: string,
): Promise<DraftFactCheckResult> {
  if (!canUseFactCheck(plan)) {
    return {
      ok: false,
      status: 403,
      message: "投稿前ファクトチェックはPlus / Proプラン限定の機能です",
      code: "FORBIDDEN",
    };
  }

  const dailyLimit = fcDailyLimit(plan);
  const quota = await consumeFcQuota(userId, plan);
  if (!quota.allowed) {
    return {
      ok: false,
      status: 429,
      message: `本日のファクトチェック回数（${dailyLimit}回）を使い切りました。明日リセットされます`,
      code: "FC_QUOTA_EXCEEDED",
    };
  }

  const chunks = await retrieveChunks(issueId, body, 3);

  const inflightOk = await acquireFcInflightSlot();
  if (!inflightOk) {
    return {
      ok: false,
      status: 503,
      message: "ファクトチェックが混み合っています。しばらく待ってからお試しください",
      code: "FC_BUSY",
    };
  }

  try {
    const result = await factCheck(body, chunks);
    const sources = buildSourceLinks(result.sourceIds, chunks);
    return {
      ok: true,
      verdict: result.verdict.toLowerCase(),
      label: result.label,
      reason: result.reason,
      sources,
      remaining: quota.remaining,
    };
  } catch (e) {
    console.error("[fc-draft] failed", e);
    return {
      ok: false,
      status: 503,
      message: "ファクトチェックが混み合っています。しばらく待ってからお試しください",
      code: "FC_UNAVAILABLE",
    };
  } finally {
    await releaseFcInflightSlot();
  }
}
