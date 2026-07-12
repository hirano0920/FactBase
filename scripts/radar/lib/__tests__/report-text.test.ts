import { describe, expect, it } from "vitest";
import {
  englishQueryFromUrl,
  isHardBlockedHost,
  isSubstantiveArticleText,
} from "../report-text";

describe("report-text overseas helpers", () => {
  it("Reuters/NYT を hard-blocked と判定する", () => {
    expect(
      isHardBlockedHost(
        "https://www.reuters.com/business/energy/iran-oil-stuck-sea-surges-2026-07-10/",
      ),
    ).toBe(true);
    expect(isHardBlockedHost("https://www.nytimes.com/2026/07/11/opinion/x.html")).toBe(true);
    expect(isHardBlockedHost("https://www.bbc.com/news/articles/abc")).toBe(false);
    expect(isHardBlockedHost("https://apnews.com/article/foo")).toBe(false);
  });

  it("URLスラッグから英語検索クエリを作る", () => {
    const q = englishQueryFromUrl(
      "https://www.reuters.com/business/energy/iran-oil-stuck-sea-surges-chinas-teapots-turn-rival-middle-east-supplies-traders-2026-07-10/",
      "イラン石油が海上に滞留",
    );
    expect(q).toContain("iran oil stuck");
    expect(q).not.toMatch(/2026/);
  });

  it("ナビだらけの薄い extract を弾く", () => {
    expect(isSubstantiveArticleText("short")).toBe(false);
    const navby = Array.from({ length: 6 }, () => "Skip to main Browse Subscribe Sign in").join(" ");
    expect(isSubstantiveArticleText(navby)).toBe(false);
    const real =
      "In recent weeks, independent Chinese refiners based in the eastern oil hub of Shandong, known as teapots, have turned to rival Middle East suppliers as Iranian oil stuck at sea surged. Traders said volumes rose as Hormuz tensions continued through July.";
    expect(isSubstantiveArticleText(real.repeat(2))).toBe(true);
  });
});
