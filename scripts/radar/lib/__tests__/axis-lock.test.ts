import { describe, expect, it } from "vitest";
import { classifyTopic, structuralAxis } from "../axis-lock";

describe("classifyTopic", () => {
  it("キオクシア急落 → stock_crash", () => {
    expect(classifyTopic("キオクシア株急落")).toBe("stock_crash");
    expect(classifyTopic("日経平均の急落（AI・半導体影響）")).toBe("stock_crash");
  });

  it("iPhone値上げ → consumer_price", () => {
    expect(classifyTopic("iPhone日本国内販売価格の引き上げ")).toBe("consumer_price");
    expect(classifyTopic("Appleの日本向けiPhone価格改定")).toBe("consumer_price");
  });

  it("特許賠償 → corporate", () => {
    expect(classifyTopic("キオクシアの特許侵害と米国賠償命令")).toBe("corporate");
  });

  it("利益相反 → fact_scandal", () => {
    expect(classifyTopic("トランプの株購入と利益相反疑惑")).toBe("fact_scandal");
  });

  it("国旗損壊罪 → legal", () => {
    expect(classifyTopic("国旗損壊罪の成立と表現の自由")).toBe("legal");
  });

  it("れいわ辞任 → politics", () => {
    expect(classifyTopic("れいわ新選組の山本太郎代表辞任")).toBe("politics");
  });
});

describe("structuralAxis", () => {
  it("代表辞任＋党名 → 党の将来軸（辞任の容認ではない）", () => {
    const axis = structuralAxis("れいわ新選組の山本太郎代表辞任");
    expect(axis.axis).toMatch(/存続|求心力|縮小/);
    expect(axis.axis).not.toMatch(/容認/);
    expect(axis.sideA + axis.sideB).toMatch(/再生|存続|縮小|求心力/);
  });

  it("株急落 → 市場反応vs実体波及（経営責任の強引2分割ではない）", () => {
    const axis = structuralAxis("キオクシア株急落");
    expect(axis.axis + axis.sideA + axis.sideB).not.toMatch(/経営責任/);
  });

  it("値上げ → コスト転嫁vs消費者負担", () => {
    const axis = structuralAxis("iPhone日本国内販売価格の引き上げ");
    expect(axis.axis).toMatch(/円安|コスト|消費者/);
  });
});
