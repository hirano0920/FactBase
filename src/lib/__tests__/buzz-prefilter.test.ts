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

  it("社会炎上・生活争点は政治ヒント無しでも trends で通す", () => {
    expect(shouldKeepBuzzTerm({ term: "企業のリストラ方針に批判殺到", source: "trends" })).toBe(true);
    expect(shouldKeepBuzzTerm({ term: "サブスク値上げに不満の声", source: "trends" })).toBe(true);
    expect(shouldKeepBuzzTerm({ term: "学校のスマホ規制は妥当か", source: "yahoo_rt", genre: "社会" })).toBe(
      true,
    );
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

  it("声明対立型（事務所が声明・契約解除等）は機械プリフィルタで弾かず、AI判定に委ねる", () => {
    expect(isBuzzGarbageTerm("○○事務所が声明、不倫疑惑を否定")).toBe(false);
    expect(isBuzzGarbageTerm("ハラスメント疑惑で契約解除、本人は反論")).toBe(false);
  });

  it("声明対立の無い単なる熱愛・結婚式・離婚報告は引き続き弾く", () => {
    expect(isBuzzGarbageTerm("芸能人カップルが熱愛発覚")).toBe(true);
    expect(isBuzzGarbageTerm("有名人夫婦が離婚を発表")).toBe(true);
  });
});
