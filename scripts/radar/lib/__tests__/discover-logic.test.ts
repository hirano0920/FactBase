import { describe, expect, it } from "vitest";
import {
  dedupeResearchTopics,
  rankBuzzTopicsForResearch,
  selectResearchTargets,
  type DiscoverResearchTopic,
} from "../discover-logic";

function buzz(topic: string, score: number, effectiveScore = score, sustained = false): DiscoverResearchTopic {
  return { topic, discoverySource: "buzz", sustained, buzz: { score, effectiveScore } };
}

function bill(topic: string): DiscoverResearchTopic {
  return { topic, discoverySource: "bill", sustained: false };
}

describe("rankBuzzTopicsForResearch", () => {
  it("buzzScore 降順、同点なら sustained 優先", () => {
    const ranked = rankBuzzTopicsForResearch([
      buzz("低", 1, 1),
      buzz("高", 3, 3),
      buzz("継続", 2, 2, true),
      buzz("中", 2, 2),
      buzz("クラスタ", 1, 2),
    ]);
    expect(ranked.map((t) => t.topic)).toEqual(["高", "継続", "クラスタ", "中", "低"]);
  });
});

describe("selectResearchTargets", () => {
  it("バズは buzzScore 順で8件、法案は別枠3件", () => {
    const buzzTopics = [
      buzz("低1", 1),
      buzz("低2", 1),
      buzz("中1", 2),
      buzz("中2", 2),
      buzz("高1", 3),
      buzz("高2", 3),
      buzz("最高", 4),
      buzz("高3", 3),
      buzz("高4", 3),
      buzz("高5", 3),
    ];
    const billTopics = Array.from({ length: 5 }, (_, i) => bill(`法案${i}`));

    const { deepResearch } = selectResearchTargets(buzzTopics, billTopics, 8, 3, () => false);

    const buzzPicked = deepResearch.filter((t) => t.discoverySource === "buzz");
    const billPicked = deepResearch.filter((t) => t.discoverySource === "bill");
    expect(buzzPicked).toHaveLength(8);
    expect(billPicked).toHaveLength(3);
    expect(buzzPicked[0].topic).toBe("最高");
    expect(buzzPicked.every((t) => (t.buzz?.effectiveScore ?? t.buzz?.score ?? 0) >= 2)).toBe(true);
  });

  it("法案がバズ枠を食わない", () => {
    const { deepResearch } = selectResearchTargets([buzz("高", 3)], [bill("A"), bill("B"), bill("C"), bill("D")], 8, 3, () => false);
    expect(deepResearch.filter((t) => t.discoverySource === "bill")).toHaveLength(3);
    expect(deepResearch.find((t) => t.discoverySource === "buzz")?.topic).toBe("高");
  });

  it("12h以内調査済みバズは深掘りせず buzzRefreshOnly", () => {
    const { deepResearch, buzzRefreshOnly } = selectResearchTargets(
      [buzz("高", 3), buzz("低", 1)],
      [],
      8,
      3,
      (topic) => topic === "高",
    );
    expect(deepResearch.map((t) => t.topic)).toEqual(["低"]);
    expect(buzzRefreshOnly.map((t) => t.topic)).toEqual(["高"]);
  });
});

describe("dedupeResearchTopics", () => {
  it("dedupKey で重複除去", () => {
    expect(dedupeResearchTopics([buzz("国旗損壊罪", 2), buzz("国旗損壊罪", 1)])).toHaveLength(1);
  });
});
