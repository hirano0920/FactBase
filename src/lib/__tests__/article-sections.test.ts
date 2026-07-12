import { describe, expect, it } from "vitest";
import { extractOpeningSummary, htmlToPlainText } from "@/lib/article-sections";

describe("extractOpeningSummary", () => {
  it("いま何が論点かセクションを要約として返す", () => {
    const html =
      "<h2>いま何が論点か</h2><p>週刊文春は撮影中の接触と否定的発言があったと報じています。佐藤さんは創作と否定しています。</p>";
    expect(extractOpeningSummary(html, "短いlead")).toContain("週刊文春");
    expect(extractOpeningSummary(html, "短いlead")).not.toBe("短いlead");
  });

  it("articleHtmlが無い場合はfallbackLeadを返す", () => {
    expect(extractOpeningSummary(null, "fallback")).toBe("fallback");
  });
});

describe("htmlToPlainText", () => {
  it("pタグとstrongを除去してプレーン化する", () => {
    expect(htmlToPlainText("<p><strong>週刊文春</strong>は報じています。</p>")).toBe(
      "週刊文春は報じています。",
    );
  });
});
