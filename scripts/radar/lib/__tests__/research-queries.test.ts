import { describe, expect, it } from "vitest";
import { buildInternationalNewsQueries, buildResearchSearchTerms } from "../research-queries";

describe("buildResearchSearchTerms", () => {
  it("正規化語に加え争点アンカー語を含める", () => {
    const terms = buildResearchSearchTerms("高市首相、NATO首脳会議を欠席");
    expect(terms[0]).toContain("高市");
    expect(terms.some((t) => /nato/i.test(t))).toBe(true);
  });

  it("為替争点では追加クエリを含める", () => {
    const terms = buildResearchSearchTerms("円安が続く");
    expect(terms.some((t) => /為替|日銀/.test(t))).toBe(true);
  });
});

describe("buildInternationalNewsQueries", () => {
  it("台湾・ウクライナなど英語クエリを追加する", () => {
    const terms = buildInternationalNewsQueries("台湾海峡の緊張");
    expect(terms.some((t) => /Taiwan/i.test(t))).toBe(true);
  });

  it("為替争点では英語の金融クエリを追加する", () => {
    const terms = buildInternationalNewsQueries("円安 日銀");
    expect(terms.some((t) => /Bank of Japan|yen/i.test(t))).toBe(true);
  });
});
