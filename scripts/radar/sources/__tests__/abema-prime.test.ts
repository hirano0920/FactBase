import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAbemaPrimeCandidates } from "../abema-prime";

const ORIGINAL_KEY = process.env.YOUTUBE_DATA_API_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.YOUTUBE_DATA_API_KEY;
  else process.env.YOUTUBE_DATA_API_KEY = ORIGINAL_KEY;
});

describe("fetchAbemaPrimeCandidates", () => {
  it("APIキー未設定時は空", async () => {
    delete process.env.YOUTUBE_DATA_API_KEY;
    await expect(fetchAbemaPrimeCandidates()).resolves.toEqual([]);
  });

  it("再生数・コメント数のしきい値未満は除外する", async () => {
    process.env.YOUTUBE_DATA_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/playlistItems?")) {
          return new Response(
            JSON.stringify({
              items: [{ contentDetails: { videoId: "high" } }, { contentDetails: { videoId: "low" } }],
            }),
            { status: 200 },
          );
        }
        if (url.includes("/videos?")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "high",
                  snippet: { title: "討論回タイトル", description: "概要", publishedAt: "2026-07-18T00:00:00Z" },
                  statistics: { viewCount: "50000", commentCount: "500" },
                },
                {
                  id: "low",
                  snippet: { title: "再生数が少ない回", description: "概要", publishedAt: "2026-07-18T00:00:00Z" },
                  statistics: { viewCount: "1000", commentCount: "5" },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const candidates = await fetchAbemaPrimeCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].videoId).toBe("high");
  });
});
