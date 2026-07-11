import { describe, expect, it } from "vitest";
import { computeBridgingScore, sortByBridgingScore } from "@/lib/bridging";

describe("computeBridgingScore", () => {
  it("helpfulCountが閾値(3)未満はhelpfulCountそのまま（コールドスタート）", () => {
    expect(computeBridgingScore(0, 0)).toBe(0);
    expect(computeBridgingScore(2, 2)).toBe(2);
  });

  it("閾値以上では相手陣営helpfulを3倍加重し、同陣営helpfulは1倍で足す", () => {
    // helpfulCount=5, crossHelpful=2 → same=3 → 2*3 + 3 = 9
    expect(computeBridgingScore(5, 2)).toBe(9);
  });

  it("crossHelpful=0でも閾値以上ならhelpfulCountのまま（ゼロにはしない）", () => {
    expect(computeBridgingScore(5, 0)).toBe(5);
  });

  it("全て相手陣営helpfulの場合は3倍がそのままスコアになる", () => {
    expect(computeBridgingScore(4, 4)).toBe(12);
  });
});

describe("sortByBridgingScore", () => {
  it("スコア降順で並べる", () => {
    const rows = [
      { id: "a", helpfulCount: 5, crossHelpful: 0, createdAt: "2026-01-01" }, // score 5
      { id: "b", helpfulCount: 5, crossHelpful: 5, createdAt: "2026-01-01" }, // score 15
    ];
    expect(sortByBridgingScore(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("同点はcreatedAt降順で並べる", () => {
    const rows = [
      { id: "old", helpfulCount: 1, crossHelpful: 0, createdAt: "2026-01-01" },
      { id: "new", helpfulCount: 1, crossHelpful: 0, createdAt: "2026-01-02" },
    ];
    expect(sortByBridgingScore(rows).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("スコアもcreatedAtも同点はid降順で並べる（安定した最終タイブレーク）", () => {
    const rows = [
      { id: "aaa", helpfulCount: 1, crossHelpful: 0, createdAt: "2026-01-01" },
      { id: "bbb", helpfulCount: 1, crossHelpful: 0, createdAt: "2026-01-01" },
    ];
    expect(sortByBridgingScore(rows).map((r) => r.id)).toEqual(["bbb", "aaa"]);
  });

  it("元配列を破壊しない", () => {
    const rows = [
      { id: "a", helpfulCount: 1, crossHelpful: 0, createdAt: "2026-01-01" },
      { id: "b", helpfulCount: 9, crossHelpful: 9, createdAt: "2026-01-01" },
    ];
    const original = [...rows];
    sortByBridgingScore(rows);
    expect(rows).toEqual(original);
  });
});
