import { afterEach, describe, expect, it, vi } from "vitest";
import { matchBroadcastArticle, mergeBroadcastMatch, BROADCASTER_DOMAINS } from "../match-broadcast";
import type { NewsItem } from "../../sources/google-news";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
  <title>国旗損壊罪法案が審議入り - NHK</title>
  <link>https://news.google.com/rss/articles/AAA</link>
  <pubDate>Sun, 05 Jul 2026 00:05:19 GMT</pubDate>
  <source url="https://www3.nhk.or.jp">NHK</source>
</item>
</channel></rss>`;

afterEach(() => vi.unstubAllGlobals());

describe("matchBroadcastArticle", () => {
  it("放送局ドメイン限定でGoogle Newsを検索し、最初の結果を返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(RSS) });
    vi.stubGlobal("fetch", fetchMock);

    const match = await matchBroadcastArticle("国旗損壊罪法案");
    expect(match?.article.title).toBe("国旗損壊罪法案が審議入り");
    expect(match?.article.url).toBe("https://news.google.com/rss/articles/AAA");

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain("site%3Awww3.nhk.or.jp");
  });

  it("短すぎるトピック語はfetchせずnullを返す", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await matchBroadcastArticle("AB")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("見つからなければnull", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>'),
      }),
    );
    expect(await matchBroadcastArticle("国旗損壊罪法案")).toBeNull();
  });

  it("fetch失敗時もnullで静かにフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await matchBroadcastArticle("国旗損壊罪法案")).toBeNull();
  });
});

describe("mergeBroadcastMatch", () => {
  const existing: NewsItem[] = [
    { title: "既存記事", source: "朝日", url: "https://asahi.example/1", pubDate: "", region: "domestic" },
  ];

  it("matchがnullなら変更しない", () => {
    expect(mergeBroadcastMatch(existing, null)).toBe(existing);
  });

  it("新しいURLの記事を追加する", () => {
    const match = {
      topic: "t",
      article: { title: "放送局記事", source: "NHK", url: "https://nhk.example/1", pubDate: "", region: "domestic" as const },
    };
    const result = mergeBroadcastMatch(existing, match);
    expect(result).toHaveLength(2);
    expect(result[1].url).toBe("https://nhk.example/1");
  });

  it("既に同じURLがあれば重複追加しない", () => {
    const match = { topic: "t", article: existing[0] };
    const result = mergeBroadcastMatch(existing, match);
    expect(result).toHaveLength(1);
  });
});

describe("BROADCASTER_DOMAINS", () => {
  it("主要な放送局ドメインを含む", () => {
    expect(BROADCASTER_DOMAINS).toContain("www3.nhk.or.jp");
    expect(BROADCASTER_DOMAINS.length).toBeGreaterThan(5);
  });
});
