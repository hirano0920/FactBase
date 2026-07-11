import { describe, expect, it } from "vitest";
import { bucketIntensity, buildHistogram, computeShift, clampIntensity } from "@/lib/spectrum";

describe("bucketIntensity", () => {
  it("中央帯(-10〜10)はUNDECIDED", () => {
    expect(bucketIntensity(0)).toBe("UNDECIDED");
    expect(bucketIntensity(10)).toBe("UNDECIDED");
    expect(bucketIntensity(-10)).toBe("UNDECIDED");
  });

  it("中央帯より上はFOR、下はAGAINST", () => {
    expect(bucketIntensity(11)).toBe("FOR");
    expect(bucketIntensity(100)).toBe("FOR");
    expect(bucketIntensity(-11)).toBe("AGAINST");
    expect(bucketIntensity(-100)).toBe("AGAINST");
  });
});

describe("buildHistogram", () => {
  it("既定10binで-100..100を均等分割する", () => {
    const bins = buildHistogram([-100, -50, 0, 50, 99], 10);
    expect(bins).toHaveLength(10);
    expect(bins[0].min).toBe(-100);
    expect(bins[9].max).toBe(100);
    const total = bins.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(5);
  });

  it("同じ値は同じbinに集計される", () => {
    const bins = buildHistogram([0, 1, 2, 3], 10);
    const middleBinCount = bins.reduce((sum, b) => sum + b.count, 0);
    expect(middleBinCount).toBe(4);
  });

  it("範囲外の値はクランプしてから分類する", () => {
    const bins = buildHistogram([200, -200], 10);
    expect(bins[9].count).toBe(1); // 200→100はmax binへ
    expect(bins[0].count).toBe(1); // -200→-100はmin binへ
  });

  it("空配列は全binが0件", () => {
    const bins = buildHistogram([], 4);
    expect(bins.every((b) => b.count === 0)).toBe(true);
  });
});

describe("computeShift", () => {
  it("母数0のときはn=0・shiftPercent=0", () => {
    expect(computeShift([])).toEqual({ n: 0, shiftedCount: 0, shiftPercent: 0 });
  });

  it("beforeとafterが変わった割合をパーセントで返す", () => {
    const result = computeShift([
      { before: "FOR", after: "FOR" },
      { before: "FOR", after: "AGAINST" },
      { before: "AGAINST", after: "AGAINST" },
      { before: "UNDECIDED", after: "FOR" },
    ]);
    expect(result.n).toBe(4);
    expect(result.shiftedCount).toBe(2);
    expect(result.shiftPercent).toBe(50);
  });
});

describe("clampIntensity", () => {
  it("範囲内はそのまま整数化", () => {
    expect(clampIntensity(42.4)).toBe(42);
    expect(clampIntensity(42.6)).toBe(43);
  });

  it("範囲外は-100〜100にクランプ", () => {
    expect(clampIntensity(150)).toBe(100);
    expect(clampIntensity(-150)).toBe(-100);
  });

  it("非数値は0にフォールバック", () => {
    expect(clampIntensity(NaN)).toBe(0);
    expect(clampIntensity(Infinity)).toBe(0);
  });
});
