/**
 * 争点ごとの「層の動き」分析（Plus限定パネル用）。
 * VoteEvent（読前/読後スナップショット）から意見変化率（A-3）と沈黙の多数派ヒートマップ（A-4）を集計する。
 */
import { prisma } from "@/lib/prisma";
import { kv } from "@/lib/redis";
import { computeShift, buildHistogram, type ShiftResult, type HistogramBin } from "@/lib/spectrum";
import type { VoteChoice } from "@prisma/client";

export interface IssueAnalytics {
  shift: ShiftResult;
  histogram: HistogramBin[];
  /** AFTER_READ（読了後スライダー）の回答者数。母数を必ず出す設計原則（過剰主張しない） */
  afterReadN: number;
}

const ANALYTICS_CACHE_TTL_SEC = 60;

export async function getIssueAnalytics(issueId: string): Promise<IssueAnalytics> {
  const cacheKey = `cache:analytics:${issueId}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as IssueAnalytics;
  } catch {
    // fall through
  }

  const events = await prisma.voteEvent.findMany({
    where: { issueId },
    select: { userId: true, phase: true, choice: true, intensity: true },
  });

  const beforeByUser = new Map<string, VoteChoice>();
  const afterByUser = new Map<string, VoteChoice>();
  const intensities: number[] = [];

  for (const e of events) {
    if (e.phase === "BEFORE_READ") {
      beforeByUser.set(e.userId, e.choice);
    } else {
      afterByUser.set(e.userId, e.choice);
      if (e.intensity !== null) intensities.push(e.intensity);
    }
  }

  const pairs: { before: VoteChoice; after: VoteChoice }[] = [];
  for (const [userId, before] of beforeByUser) {
    const after = afterByUser.get(userId);
    if (after) pairs.push({ before, after });
  }

  const result: IssueAnalytics = {
    shift: computeShift(pairs),
    histogram: buildHistogram(intensities, 10),
    afterReadN: afterByUser.size,
  };

  try {
    await kv.set(cacheKey, JSON.stringify(result), { ex: ANALYTICS_CACHE_TTL_SEC });
  } catch {
    // ignore
  }

  return result;
}
