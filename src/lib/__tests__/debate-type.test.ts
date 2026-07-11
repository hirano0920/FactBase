/**
 * TwoSides 争点タイプ（debate-type）のユニットテスト。
 */
import { describe, expect, it } from "vitest";
import {
  debateTypePromoteBonus,
  inferDebateType,
  isPromotableDebateType,
  resolveDebateType,
  debateTypeTitleHint,
  debateTypeChoiceHint,
  DEBATE_TYPES,
} from "../debate-type";

describe("inferDebateType", () => {
  it("声明対立シグナル → declaration", () => {
    expect(inferDebateType({ topic: "事務所が声明、本人は反論", category: "entertainment" })).toBe(
      "declaration",
    );
  });

  it("finance / 金利 → indicator", () => {
    expect(inferDebateType({ topic: "日銀の政策金利判断", category: "finance" })).toBe("indicator");
  });

  it("international → geopolitics", () => {
    expect(inferDebateType({ topic: "停戦交渉", category: "international" })).toBe("geopolitics");
  });

  it("society → norm_flare", () => {
    expect(inferDebateType({ topic: "マナー論争", category: "society" })).toBe("norm_flare");
  });

  it("politics / 法案 → policy", () => {
    expect(inferDebateType({ topic: "選択的夫婦別姓", category: "politics" })).toBe("policy");
  });

  it("謝罪・処分 → org_response", () => {
    expect(inferDebateType({ topic: "企業の謝罪と処分", category: "economy" })).toBe("org_response");
  });

  it("薄い速報・カテゴリ不明 → null", () => {
    expect(inferDebateType({ topic: "速報", category: null })).toBeNull();
  });
});

describe("resolveDebateType", () => {
  it("AIのdebateTypeを優先する", () => {
    const r = resolveDebateType({
      topic: "日銀",
      category: "finance",
      debateType: "policy",
    });
    expect(r).toEqual({ debateType: "policy", reignite: false });
  });

  it("policy + sustained → reignite", () => {
    const r = resolveDebateType({
      topic: "原発再稼働",
      category: "politics",
      debateType: "policy",
      sustained: true,
    });
    expect(r?.reignite).toBe(true);
  });

  it("不正なdebateTypeは機械推定にフォールバック", () => {
    const r = resolveDebateType({
      topic: "事務所が声明",
      category: "entertainment",
      debateType: "breaking_thin",
    });
    expect(r?.debateType).toBe("declaration");
  });
});

describe("isPromotableDebateType / bonus", () => {
  it("本線6型のみ promote 可", () => {
    expect(isPromotableDebateType("declaration")).toBe(true);
    expect(isPromotableDebateType("breaking")).toBe(false);
    expect(isPromotableDebateType(null)).toBe(false);
  });

  it("declaration が最大ボーナス", () => {
    expect(debateTypePromoteBonus("declaration")).toBeGreaterThan(debateTypePromoteBonus("policy"));
    expect(debateTypePromoteBonus("norm_flare")).toBeGreaterThan(debateTypePromoteBonus("indicator"));
  });
});

describe("debateTypeTitleHint", () => {
  it("全6型がヒントを返す（未定義でクラッシュしない）", () => {
    for (const t of DEBATE_TYPES) {
      expect(debateTypeTitleHint(t).length).toBeGreaterThan(0);
    }
  });

  it("declaration/norm_flareは好奇心フック、policy/indicatorは家計フックを案内する", () => {
    expect(debateTypeTitleHint("declaration")).toContain("好奇心");
    expect(debateTypeTitleHint("norm_flare")).toContain("好奇心");
    expect(debateTypeTitleHint("policy")).toContain("家計");
    expect(debateTypeTitleHint("indicator")).toContain("家計");
  });
});

describe("debateTypeChoiceHint", () => {
  it("全6型がヒントを返す（未定義でクラッシュしない）", () => {
    for (const t of DEBATE_TYPES) {
      expect(debateTypeChoiceHint(t).length).toBeGreaterThan(0);
    }
  });
});
