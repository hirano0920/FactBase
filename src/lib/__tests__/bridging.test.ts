import { describe, expect, it } from "vitest";
import { computeBridgingScore, sortByBridgingScore } from "@/lib/bridging";

describe("computeBridgingScore", () => {
  it("helpfulCountが閾値(3)未満はhelpfulCountそのまま（コールドスタート）", () => {
    expect(computeBridgingScore(0, 0)).toBe(0);
    expect(computeBridgingScore(2, 2)).toBe(2);
  });

  it("閾値以上では相手陣営helpfulを5倍加重し、同陣営helpfulは1倍で足す", () => {
    // helpfulCount=5, crossHelpful=2, neutralHelpful=0 → same=3 → 2*5 + 0*4 + 3 = 13
    expect(computeBridgingScore(5, 2)).toBe(13);
  });

  it("中立（UNDECIDED）からのhelpfulは4倍加重（反対派よりさらに高い）", () => {
    // helpfulCount=5, crossHelpful=0, neutralHelpful=2 → same=3 → 0*5 + 2*4 + 3 = 11
    expect(computeBridgingScore(5, 0, 2)).toBe(11);
  });

  it("crossHelpfulとneutralHelpfulが混在する場合は両方加重", () => {
    // helpfulCount=7, crossHelpful=2, neutralHelpful=1 → same=4 → 2*5 + 1*4 + 4 = 18
    expect(computeBridgingScore(7, 2, 1)).toBe(18);
  });

  it("crossHelpful=0でも閾値以上ならhelpfulCountのまま（ゼロにはしない）", () => {
    expect(computeBridgingScore(5, 0)).toBe(5);
  });

  it("全て相手陣営helpfulの場合は5倍がそのままスコアになる", () => {
    expect(computeBridgingScore(4, 4)).toBe(20);
  });
});

describe("sortByBridgingScore", () => {
  it("スコア降順で並べる", () => {
    const rows = [
      { id: "a", helpfulCount: 5, crossHelpful: 0, neutralHelpful: 0, createdAt: "2026-01-01" }, // score 5
      { id: "b", helpfulCount: 5, crossHelpful: 5, neutralHelpful: 0, createdAt: "2026-01-01" }, // score 25
    ];
    expect(sortByBridgingScore(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("中立helpfulがcrossHelpfulより優先される", () => {
    // 中立2票 = 8点、反対2票 = 10点 → 反対2票が上（5倍なので）
    const rows = [
      { id: "neutral", helpfulCount: 5, crossHelpful: 0, neutralHelpful: 2, createdAt: "2026-01-01" }, // 0*5 + 2*4 + 3 = 11
      { id: "cross", helpfulCount: 4, crossHelpful: 2, neutralHelpful: 0, createdAt: "2026-01-01" }, // 2*5 + 0*4 + 2 = 12
    ];
    expect(sortByBridgingScore(rows).map((r) => r.id)).toEqual(["cross", "neutral"]);
  });

  it("同点はcreatedAt降順で並べる", () => {
    const rows = [
      { id: "old", helpfulCount: 1, crossHelpful: 0, neutralHelpful: 0, createdAt: "2026-01-01" },
      { id: "new", helpfulCount: 1, crossHelpful: 0, neutralHelpful: 0, createdAt: "2026-01-02" },
    ];
    expect(sortByBridgingScore(rows).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("スコアもcreatedAtも同点はid降順で並べる（安定した最終タイブレーク）", () => {
    const rows = [
      { id: "aaa", helpfulCount: 1, crossHelpful: 0, neutralHelpful: 0, createdAt: "2026-01-01" },
      { id: "bbb", helpfulCount: 1, crossHelpful: 0, neutralHelpful: 0, createdAt: "2026-01-01" },
    ];
    expect(sortByBridgingScore(rows).map((r) => r.id)).toEqual(["bbb", "aaa"]);
  });

  it("元配列を破壊しない", () => {
    const rows = [
      { id: "a", helpfulCount: 1, crossHelpful: 0, neutralHelpful: 0, createdAt: "2026-01-01" },
      { id: "b", helpfulCount: 9, crossHelpful: 9, neutralHelpful: 0, createdAt: "2026-01-01" },
    ];
    const original = [...rows];
    sortByBridgingScore(rows);
    expect(rows).toEqual(original);
  });
});
