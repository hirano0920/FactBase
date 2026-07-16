import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYouTubeTrendingTitles, matchYouTubeEntry, fetchYouTubeReplyIntensity } from "../youtube-trending";

const ORIGINAL_KEY = process.env.YOUTUBE_DATA_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
  else process.env.YOUTUBE_DATA_API_KEY = ORIGINAL_KEY;
});

describe("fetchYouTubeTrendingTitles", () => {
  it("APIキー未設定時は空", async () => {
    delete process.env.YOUTUBE_DATA_API_KEY;
    await expect(fetchYouTubeTrendingTitles()).resolves.toEqual({ organic: [], all: [] });
  });

  it("総合 mostPopular・News mostPopular・search(organic)を統計込みで返す（シード検索は含まない）", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/videos?") && url.includes("chart=mostPopular")) {
          const isNews = url.includes("videoCategoryId=25");
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: isNews ? "vid-news" : "vid-general",
                  snippet: {
                    title: isNews ? "日銀政策正常化の行方" : "企業リストラ方針に批判殺到",
                    channelTitle: "テストch",
                  },
                  statistics: { viewCount: "1000", likeCount: "50", commentCount: "10" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/videos?") && url.includes("part=statistics")) {
          // search結果への統計バッチ取得
          return new Response(
            JSON.stringify({
              items: [{ id: "vid-search", statistics: { viewCount: "500", likeCount: "5", commentCount: "3" } }],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/search?")) {
          return new Response(
            JSON.stringify({
              items: [
                { id: { videoId: "vid-news" }, snippet: { title: "日銀政策正常化の行方", channelTitle: "テストch" } },
                { id: { videoId: "vid-search" }, snippet: { title: "中東情勢と原油相場", channelTitle: "別ch" } },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const result = await fetchYouTubeTrendingTitles();
    expect(result.organic).toEqual([
      { videoId: "vid-general", title: "企業リストラ方針に批判殺到", channelTitle: "テストch", viewCount: 1000, likeCount: 50, commentCount: 10 },
      { videoId: "vid-news", title: "日銀政策正常化の行方", channelTitle: "テストch", viewCount: 1000, likeCount: 50, commentCount: 10 },
      { videoId: "vid-search", title: "中東情勢と原油相場", channelTitle: "別ch", viewCount: 500, likeCount: 5, commentCount: 3 },
    ]);
    expect(result.all).toEqual(result.organic);
    // 総合 + News & Politics の2系統
    const videoListCalls = vi
      .mocked(fetch)
      .mock.calls.filter((c) => String(c[0]).includes("chart=mostPopular"));
    expect(videoListCalls.length).toBe(2);
  });

  it("ニュース見出しシードの検索結果はallにのみ含まれ、organicには含まれない（自己参照防止）", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("chart=mostPopular")) {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (url.includes("/videos?") && url.includes("part=statistics")) {
          return new Response(
            JSON.stringify({ items: [{ id: "vid-seed", statistics: { viewCount: "20", commentCount: "1" } }] }),
            { status: 200 },
          );
        }
        if (url.includes("/search?")) {
          const q = new URL(url).searchParams.get("q") ?? "";
          if (q.includes("学位剥奪")) {
            return new Response(
              JSON.stringify({
                items: [
                  { id: { videoId: "vid-seed" }, snippet: { title: "学位剥奪スキャンダルまとめ", channelTitle: "まとめch" } },
                ],
              }),
              { status: 200 },
            );
          }
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const result = await fetchYouTubeTrendingTitles(["中国作家、論文盗用で学位剥奪"]);
    expect(result.organic).toEqual([]);
    expect(result.all).toEqual([
      { videoId: "vid-seed", title: "学位剥奪スキャンダルまとめ", channelTitle: "まとめch", viewCount: 20, likeCount: 0, commentCount: 1 },
    ]);
  });

  it("API失敗時は空", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("error", { status: 500 })));

    await expect(fetchYouTubeTrendingTitles()).resolves.toEqual({ organic: [], all: [] });
  });
});

describe("matchYouTubeEntry", () => {
  const entries = [
    { videoId: "a", title: "日銀、追加利上げを検討", channelTitle: "A", viewCount: 100, likeCount: 1, commentCount: 1 },
    { videoId: "b", title: "日銀、追加利上げへ", channelTitle: "B", viewCount: 500, likeCount: 2, commentCount: 2 },
  ];

  it("複数一致時は再生数が最も多いものを採用する", () => {
    expect(matchYouTubeEntry("日銀", entries)?.viewCount).toBe(500);
  });

  it("一致が無ければundefined", () => {
    expect(matchYouTubeEntry("無関係な話題", entries)).toBeUndefined();
  });
});

describe("fetchYouTubeReplyIntensity", () => {
  it("APIキー未設定時は0", async () => {
    delete process.env.YOUTUBE_DATA_API_KEY;
    expect(await fetchYouTubeReplyIntensity("vid-1")).toBe(0);
  });

  it("上位コメントのtotalReplyCountを合計する", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/commentThreads?");
        expect(url).toContain("videoId=vid-1");
        return new Response(
          JSON.stringify({
            items: [{ snippet: { totalReplyCount: 31 } }, { snippet: { totalReplyCount: 4 } }, { snippet: {} }],
          }),
          { status: 200 },
        );
      }),
    );
    expect(await fetchYouTubeReplyIntensity("vid-1")).toBe(35);
  });

  it("コメント欄無効化・API失敗時は0", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("error", { status: 403 })));
    expect(await fetchYouTubeReplyIntensity("vid-1")).toBe(0);
  });
});
