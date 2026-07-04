import { describe, expect, it } from "vitest";
import { tierForCount, tierLabel } from "@/lib/badges";

describe("tierForCount", () => {
  it("4回以下は称号なし", () => {
    expect(tierForCount(0)).toBeNull();
    expect(tierForCount(4)).toBeNull();
  });

  it("5〜19回はbronze", () => {
    expect(tierForCount(5)).toBe("bronze");
    expect(tierForCount(19)).toBe("bronze");
  });

  it("20〜49回はsilver", () => {
    expect(tierForCount(20)).toBe("silver");
    expect(tierForCount(49)).toBe("silver");
  });

  it("50〜99回はgold", () => {
    expect(tierForCount(50)).toBe("gold");
    expect(tierForCount(99)).toBe("gold");
  });

  it("100回以上はpro", () => {
    expect(tierForCount(100)).toBe("pro");
    expect(tierForCount(9999)).toBe("pro");
  });
});

describe("tierLabel", () => {
  it("既知のtierは表示ラベルを返す", () => {
    expect(tierLabel("bronze")).toBe("Bronze");
    expect(tierLabel("pro")).toBe("Pro");
  });

  it("未知の値はそのまま返す（防御的フォールバック）", () => {
    expect(tierLabel("mystery")).toBe("mystery");
  });
});
