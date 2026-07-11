import { BRIDGING_CROSS_WEIGHT, BRIDGING_MIN_SAMPLE } from "@/lib/constants";

/**
 * 越境評価スコア。helpfulCountが閾値未満のうちは1票の増減で順位が乱高下するため
 * 単純helpful順にフォールバックし、閾値以上になって初めて相手陣営helpfulを重く見る。
 */
export function computeBridgingScore(helpfulCount: number, crossHelpful: number): number {
  if (helpfulCount < BRIDGING_MIN_SAMPLE) return helpfulCount;
  const sameHelpful = helpfulCount - crossHelpful;
  return crossHelpful * BRIDGING_CROSS_WEIGHT + sameHelpful;
}

export interface BridgingRow {
  id: string;
  helpfulCount: number;
  crossHelpful: number;
  createdAt: string | Date;
}

/**
 * スコア降順、同点はcreatedAt降順→id降順で安定ソートする（commentOrderBy()と同じ規約）。
 */
export function sortByBridgingScore<T extends BridgingRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const scoreDiff =
      computeBridgingScore(b.helpfulCount, b.crossHelpful) -
      computeBridgingScore(a.helpfulCount, a.crossHelpful);
    if (scoreDiff !== 0) return scoreDiff;
    const createdDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (createdDiff !== 0) return createdDiff;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}
