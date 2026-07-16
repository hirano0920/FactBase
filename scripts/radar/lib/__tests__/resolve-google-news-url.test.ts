import { describe, expect, it } from "vitest";
import {
  isGoogleNewsArticleUrl,
  isYahooArticleUrl,
  resolveYahooArticleUrl,
} from "../resolve-google-news-url";

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

describe("isYahooArticleUrl", () => {
  it("yahoo記事URLのみtrue", () => {
    expect(
      isYahooArticleUrl("https://news.yahoo.co.jp/articles/abc123def4567890abc123def4567890abc123de"),
    ).toBe(true);
    expect(isYahooArticleUrl("https://news.yahoo.co.jp/polls/1")).toBe(false);
  });
});

describe("resolveYahooArticleUrl", () => {
  it("直接Yahoo URLがあればそれを返す（Google解決不要）", async () => {
    const url = "https://news.yahoo.co.jp/articles/abc123def4567890abc123def4567890abc123de";
    expect(await resolveYahooArticleUrl(["https://www.nikkei.com/x", url])).toBe(url);
  });

  it("YahooでもGoogleでもないURLだけならnull", async () => {
    expect(await resolveYahooArticleUrl(["https://www.nikkei.com/article/x"])).toBeNull();
  });
});
