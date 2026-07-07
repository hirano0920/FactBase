import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWikipediaBackground } from "../wikipedia";

afterEach(() => vi.unstubAllGlobals());

describe("fetchWikipediaBackground", () => {
  it("完全一致ページがあればそのままsummaryを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            title: "国旗損壊罪法案",
            extract: "国旗を損壊する行為を処罰する法案。",
            content_urls: { desktop: { page: "https://ja.wikipedia.org/wiki/X" } },
          }),
      }),
    );
    const bg = await fetchWikipediaBackground("国旗損壊罪法案");
    expect(bg?.title).toBe("国旗損壊罪法案");
    expect(bg?.extract).toContain("国旗を損壊");
  });

  it("完全一致が404なら検索APIでタイトルを引いて再取得する", async () => {
    const fetchMock = vi
      .fn()
      // 1回目: summary 完全一致 → 404
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // 2回目: search API → タイトルが見つかる
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ query: { search: [{ title: "日本の国旗" }] } }),
      })
      // 3回目: summary（検索で見つけたタイトル）
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            title: "日本の国旗",
            extract: "日章旗は日本の国旗。",
            content_urls: { desktop: { page: "https://ja.wikipedia.org/wiki/日本の国旗" } },
          }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const bg = await fetchWikipediaBackground("日の丸");
    expect(bg?.title).toBe("日本の国旗");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("検索でも見つからなければnull", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ query: { search: [] } }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchWikipediaBackground("存在しない話題XYZ")).toBeNull();
  });

  it("2文字未満の語は検索せずnull", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchWikipediaBackground("あ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch失敗時はnullにフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchWikipediaBackground("国旗損壊罪")).toBeNull();
  });

  it("HTTP 500等（404以外のエラー）もnullにフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await fetchWikipediaBackground("国旗損壊罪")).toBeNull();
  });
});
