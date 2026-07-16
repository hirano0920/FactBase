import { describe, expect, it } from "vitest";
import { pearsonCorrelation, bucketAverages } from "../stats";

describe("pearsonCorrelation", () => {
  it("完全な正の相関は1", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
  });

  it("完全な負の相関は-1", () => {
    expect(pearsonCorrelation([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
  });

  it("無相関に近ければ0に近い", () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
    expect(r).not.toBeNull();
    expect(Math.abs(r as number)).toBeLessThan(0.6);
  });

  it("ペア数が2未満はnull", () => {
    expect(pearsonCorrelation([1], [1])).toBeNull();
    expect(pearsonCorrelation([], [])).toBeNull();
  });

  it("長さが違えばnull", () => {
    expect(pearsonCorrelation([1, 2], [1])).toBeNull();
  });

  it("分散が0（全部同じ値）ならnull", () => {
    expect(pearsonCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
    expect(pearsonCorrelation([1, 2, 3], [5, 5, 5])).toBeNull();
  });
});

describe("bucketAverages", () => {
  it("xの昇順でbucketCount個に等分し、各バケツのy平均を返す", () => {
    const pairs = [
      { x: 1, y: 10 },
      { x: 2, y: 20 },
      { x: 3, y: 30 },
      { x: 4, y: 40 },
    ];
    const buckets = bucketAverages(pairs, 2);
    expect(buckets).toHaveLength(2);
    expect(buckets[0].yMean).toBeCloseTo(15);
    expect(buckets[1].yMean).toBeCloseTo(35);
  });

  it("空配列は空配列", () => {
    expect(bucketAverages([], 3)).toEqual([]);
  });

  it("順不同の入力でもxでソートしてから分割する", () => {
    const pairs = [
      { x: 3, y: 30 },
      { x: 1, y: 10 },
      { x: 2, y: 20 },
    ];
    const buckets = bucketAverages(pairs, 3);
    expect(buckets.map((b) => b.yMean)).toEqual([10, 20, 30]);
  });
});
