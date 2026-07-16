/**
 * TwoSides 争点タイプ（debate-type）のユニットテスト。
 */
import { describe, expect, it } from "vitest";
import {
  debateTypePromoteBonus,
  detectForSideIndex,
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

  it("法案＋反対声明でも declaration にせず policy", () => {
    expect(
      inferDebateType({
        topic: "国旗損壊罪法案",
        category: "politics",
        newsTitles: ["沖縄弁護士会が反対声明"],
      }),
    ).toBe("policy");
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

  it("法案＋反対声明を declaration と誤分類しても policy に矯正する", () => {
    const r = resolveDebateType({
      topic: "国旗損壊罪法案に反対声明",
      category: "politics",
      debateType: "declaration",
      newsTitles: ["沖縄弁護士会が廃案を求める声明"],
    });
    expect(r?.debateType).toBe("policy");
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

  it("org_responseは空虚な仮定フック（『自分も同じ立場なら』）を案内しない", () => {
    // 2026-07-15: この文言が「自分が学生ならどう感じる？」等の空虚な仮定フックの
    // 直接の原因だったため、具体的な影響（返金・補償・処分内容等）を案内する形に修正した
    expect(debateTypeTitleHint("org_response")).not.toContain("自分も同じ立場なら");
  });
});

describe("debateTypeChoiceHint", () => {
  it("全6型がヒントを返す（未定義でクラッシュしない）", () => {
    for (const t of DEBATE_TYPES) {
      expect(debateTypeChoiceHint(t).length).toBeGreaterThan(0);
    }
  });

  it("policyは人物名禁止・賛否ラベルを案内する", () => {
    expect(debateTypeChoiceHint("policy")).toContain("人物名");
    expect(debateTypeChoiceHint("policy")).toMatch(/賛成|反対/);
  });
});

describe("detectForSideIndex", () => {
  it("生成順どおり（賛成が先）でも正しく判定する", () => {
    expect(detectForSideIndex("賛成側が言うこと", "反対側が言うこと")).toBe(0);
  });

  it("AIが反対側を先に書いた場合、位置でなく文言で賛成側を判定する（回帰テスト: 色反転バグ）", () => {
    expect(detectForSideIndex("反対側が言うこと", "賛成側が言うこと")).toBe(1);
  });

  it("org_response型（支持/問題）も判定できる", () => {
    expect(detectForSideIndex("問題だとする側", "対応を支持する側")).toBe(1);
  });

  it("norm_flare型（擁護/批判）も判定できる", () => {
    expect(detectForSideIndex("擁護側が言うこと", "批判側が言うこと")).toBe(0);
  });

  it("どちらの見出しにも極性語が無ければnull（呼び出し側は生成順にフォールバック）", () => {
    expect(detectForSideIndex("週刊文春・報道側", "佐藤二朗さん側")).toBeNull();
  });

  it("両方に賛成/反対語が混在するなど曖昧な場合はnull", () => {
    expect(detectForSideIndex("賛成でも反対でもある側", "もう一方の側")).toBeNull();
  });
});
