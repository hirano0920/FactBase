import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYouTubeTrendingTitles } from "../youtube-trending";

const ORIGINAL_KEY = process.env.YOUTUBE_DATA_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
  else process.env.YOUTUBE_DATA_API_KEY = ORIGINAL_KEY;
});

describe("fetchYouTubeTrendingTitles", () => {
  it("APIキー未設定時は空配列", async () => {
    delete process.env.YOUTUBE_DATA_API_KEY;
    await expect(fetchYouTubeTrendingTitles()).resolves.toEqual([]);
  });

  it("総合 mostPopular・News mostPopular・search のタイトルを重複除去して返す", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/videos?")) {
          const isNews = url.includes("videoCategoryId=25");
          return new Response(
            JSON.stringify({
              items: [
                {
                  snippet: {
                    title: isNews ? "日銀政策正常化の行方" : "企業リストラ方針に批判殺到",
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/search?")) {
          return new Response(
            JSON.stringify({
              items: [
                { snippet: { title: "日銀政策正常化の行方" } },
                { snippet: { title: "中東情勢と原油相場" } },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const titles = await fetchYouTubeTrendingTitles();
    expect(titles).toEqual([
      "企業リストラ方針に批判殺到",
      "日銀政策正常化の行方",
      "中東情勢と原油相場",
    ]);
    // 総合 + News & Politics の2系統
    const videoCalls = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes("/videos?"));
    expect(videoCalls.length).toBe(2);
  });

  it("API失敗時は空配列", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("error", { status: 500 })));

    await expect(fetchYouTubeTrendingTitles()).resolves.toEqual([]);
  });
});
