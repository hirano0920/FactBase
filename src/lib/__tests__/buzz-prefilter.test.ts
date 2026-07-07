import { describe, expect, it } from "vitest";
import { isBuzzGarbageTerm, prefilterBuzzTerms, shouldKeepBuzzTerm } from "@/lib/buzz-prefilter";

describe("buzz-prefilter", () => {
  it("W杯・スポーツ系は捨てる", () => {
    expect(isBuzzGarbageTerm("ベルギー")).toBe(true);
    expect(isBuzzGarbageTerm("【W杯】日本代表が勝利")).toBe(true);
    expect(shouldKeepBuzzTerm({ term: "ベルギー頑張れ", source: "yahoo_rt", genre: "スポーツ" })).toBe(false);
  });

  it("政治・経済キーワードは残す", () => {
    expect(shouldKeepBuzzTerm({ term: "政治資金規正法", source: "trends" })).toBe(true);
    expect(shouldKeepBuzzTerm({ term: "円安が続く", source: "yahoo_rt", genre: "ニュース" })).toBe(true);
  });

  it("yahoo_news / youtube はソース信頼で通す（ゴミパターン以外）", () => {
    expect(
      shouldKeepBuzzTerm({
        term: "日銀、政策金利を据え置き",
        source: "yahoo_news",
      }),
    ).toBe(true);
    expect(
      shouldKeepBuzzTerm({
        term: "台風9号の特徴、今後の進路は",
        source: "yahoo_news",
      }),
    ).toBe(false);
    expect(
      shouldKeepBuzzTerm({
        term: "入管法改正をめぐる論点",
        source: "youtube",
      }),
    ).toBe(true);
  });

  it("prefilterBuzzTerms で重複除去", () => {
    const out = prefilterBuzzTerms(["政治資金", "政治資金", "W杯"], "trends");
    expect(out).toEqual(["政治資金"]);
  });
});
