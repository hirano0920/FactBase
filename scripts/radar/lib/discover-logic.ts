/**
 * discover.ts ③ 深掘り対象の選定（純関数・テスト可能）。
 * promote 用 PENDING の質を上げるため、buzz は buzzScore 降順で枠を埋める。
 * 法案は別枠（promote 対象外のため buzz 枠を食わない）。
 */
import { dedupKey } from "../../../src/lib/radar";

export interface DiscoverResearchTopic {
  topic: string;
  discoverySource: "buzz" | "bill";
  sustained: boolean;
  buzz?: { score: number; effectiveScore: number };
}

export function buzzResearchScore(buzz?: { score: number; effectiveScore: number }): number {
  return buzz?.effectiveScore ?? buzz?.score ?? 0;
}

export function rankBuzzTopicsForResearch<T extends DiscoverResearchTopic>(topics: T[]): T[] {
  return [...topics].sort((a, b) => {
    const scoreA = buzzResearchScore(a.buzz);
    const scoreB = buzzResearchScore(b.buzz);
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (a.sustained !== b.sustained) return a.sustained ? -1 : 1;
    return a.topic.localeCompare(b.topic, "ja");
  });
}

export function dedupeResearchTopics<T extends DiscoverResearchTopic>(topics: T[]): T[] {
  const seen = new Set<string>();
  return topics.filter((t) => {
    const key = dedupKey(t.topic);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface SelectResearchTargetsResult<T extends DiscoverResearchTopic> {
  deepResearch: T[];
  buzzRefreshOnly: T[];
}

/**
 * @param recentlyResearched 12h以内に深掘り済みなら true（再調査せず buzz 更新のみ）
 */
export function selectResearchTargets<T extends DiscoverResearchTopic>(
  buzzTopics: T[],
  billTopics: T[],
  buzzLimit: number,
  billLimit: number,
  recentlyResearched: (topic: string) => boolean,
): SelectResearchTargetsResult<T> {
  const deepResearch: T[] = [];
  const buzzRefreshOnly: T[] = [];

  for (const t of dedupeResearchTopics(billTopics)) {
    if (deepResearch.filter((x) => x.discoverySource === "bill").length >= billLimit) break;
    if (recentlyResearched(t.topic)) continue;
    deepResearch.push(t);
  }

  const buzzRanked = rankBuzzTopicsForResearch(dedupeResearchTopics(buzzTopics));
  let buzzDeepCount = 0;
  for (const t of buzzRanked) {
    if (buzzDeepCount >= buzzLimit) break;
    if (recentlyResearched(t.topic)) {
      if (t.discoverySource === "buzz" && t.buzz) buzzRefreshOnly.push(t);
      continue;
    }
    deepResearch.push(t);
    buzzDeepCount++;
  }

  return { deepResearch, buzzRefreshOnly };
}
