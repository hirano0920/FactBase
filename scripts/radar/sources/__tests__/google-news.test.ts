import { afterEach, describe, expect, it, vi } from "vitest";
import { searchNews, searchInternationalNews } from "../google-news";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
  <title>国旗損壊罪法案が審議入り - 佐賀新聞</title>
  <link>https://news.google.com/rss/articles/AAA</link>
  <pubDate>Sun, 05 Jul 2026 00:05:19 GMT</pubDate>
  <source url="https://www.saga-s.co.jp">佐賀新聞</source>
</item>
<item>
  <title>国旗損壊罪、参院へ - Yahoo!ニュース</title>
  <link>https://news.google.com/rss/articles/BBB</link>
  <pubDate>Sun, 05 Jul 2026 01:00:00 GMT</pubDate>
  <source url="https://news.yahoo.co.jp">Yahoo!ニュース</source>
</item>
</channel></rss>`;

afterEach(() => vi.unstubAllGlobals());

describe("searchNews", () => {
  it("見出しから媒体名サフィックスを除き、媒体名とURLを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(RSS) }),
    );
    const news = await searchNews("国旗損壊罪", 8);
    expect(news).toHaveLength(2);
    expect(news[0].title).toBe("国旗損壊罪法案が審議入り"); // " - 佐賀新聞" 除去
    expect(news[0].source).toBe("佐賀新聞");
    expect(news[0].url).toBe("https://news.google.com/rss/articles/AAA");
    expect(news[0].region).toBe("domestic");
  });

  it("limitで件数を絞る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(RSS) }),
    );
    expect(await searchNews("国旗損壊罪", 1)).toHaveLength(1);
  });

  it("fetch失敗時は空配列にフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await searchNews("国旗損壊罪")).toEqual([]);
  });

  it("HTTPエラーも空配列にフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await searchNews("国旗損壊罪")).toEqual([]);
  });
});

describe("searchInternationalNews", () => {
  it("英語圏ロケール(en-US/US)でリクエストし、region=internationalを付与する", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(RSS) });
    vi.stubGlobal("fetch", fetchMock);
    const news = await searchInternationalNews("国旗損壊罪", 5);
    expect(news).toHaveLength(2);
    expect(news[0].region).toBe("international");
    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain("hl=en-US");
    expect(requestedUrl).toContain("gl=US");
  });

  it("fetch失敗時は空配列にフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await searchInternationalNews("国旗損壊罪")).toEqual([]);
  });
});
