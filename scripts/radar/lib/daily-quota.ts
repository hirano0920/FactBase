/**
 * バズ記事の日次本数ガード（Selection V2）。
 * 硬上限のみ。最低本数キャッチアップはしない（カス埋め禁止）。
 */

export interface PromoteRunBudgetInput {
  todayCount: number;
  baseLimit: number;
  /** @deprecated Selection V2 では未使用（互換のため残す） */
  minTarget: number;
  softTarget: number;
  hardCap: number;
  inPeakWindow: boolean;
  remainingPeaks: number;
  force?: boolean;
}

export interface PromoteRunBudget {
  shouldRun: boolean;
  targetCount: number;
  reason: string;
}

export function countRemainingPeaks(
  now: Date,
  windows: readonly { hour: number; minute: number }[],
  toleranceMin: number,
): number {
  const jst = new Date(now.getTime() + 9 * 60 * 60_000);
  const nowMinutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  return windows.filter((w) => {
    const start = w.hour * 60 + w.minute;
    return nowMinutes <= start + toleranceMin;
  }).length;
}

/**
 * - 硬上限到達 → 走らない
 * - ピーク内 → 「今日使ってよい枠」を残りピーク数で均等按分し、baseLimit/room/公平配分の最小値まで。
 *   最低未達でも増やさない（日次補充なし）。
 * - ピーク外 → force 以外は走らない（日次補充なし）
 *
 * 均等配分の考え方: softTarget未達の間は「今日使ってよい枠」をsoftTargetの残りに制限し
 * （通常ペース）、softTarget到達後はhardCapの残りまで解放する（例外的にバズる日の上振れ許容）。
 * どちらの枠であっても、それを残りピーク数で均等に割ることで「最初のピークで良ネタが多かった
 * せいで最後のピークがほぼ空枠になる」という偏りを防ぐ（2026-07-16: remainingPeaksが
 * 計算はされていたのに使われていなかった不具合を修正）。
 */
export function computePromoteRunBudget(input: PromoteRunBudgetInput): PromoteRunBudget {
  const room = Math.max(0, input.hardCap - input.todayCount);
  if (room === 0) {
    return { shouldRun: false, targetCount: 0, reason: "daily_hard_cap" };
  }

  if (input.inPeakWindow) {
    const budgetCeiling =
      input.softTarget > 0 && input.todayCount < input.softTarget
        ? Math.min(input.softTarget - input.todayCount, room)
        : room;
    const peaks = Math.max(1, input.remainingPeaks);
    const fairShare = Math.ceil(budgetCeiling / peaks);
    const target = Math.max(1, Math.min(input.baseLimit, room, fairShare));
    return { shouldRun: true, targetCount: target, reason: "peak" };
  }

  if (input.force) {
    return {
      shouldRun: true,
      targetCount: Math.min(room, input.baseLimit),
      reason: "force",
    };
  }

  return { shouldRun: false, targetCount: 0, reason: "outside_peak" };
}
