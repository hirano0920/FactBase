import { describe, expect, it } from "vitest";
import { isGoogleNewsArticleUrl } from "../resolve-google-news-url";

describe("isGoogleNewsArticleUrl", () => {
  it("news.google.com/articles を検出する", () => {
    expect(
      isGoogleNewsArticleUrl(
        "https://news.google.com/rss/articles/CBMiSGh0dHBzOi8vZXhhbXBsZS5jb20v?oc=5",
      ),
    ).toBe(true);
    expect(isGoogleNewsArticleUrl("https://news.google.com/articles/CBMiabc")).toBe(true);
  });

  it("出版社URLは false", () => {
    expect(isGoogleNewsArticleUrl("https://www.nikkei.com/article/DGXZQOUB123")).toBe(false);
  });
});
