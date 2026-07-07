import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYahooRealtimeBuzz } from "../yahoo-realtime";

function pageWithNextData(json: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(json)}</script></body></html>`;
}

const NEXT_DATA = {
  props: {
    pageProps: {
      pageData: {
        buzzTrend: {
          items: [
            { query: "弾道ミサイル発射", tweetCount: 194, genre: "ニュース" },
            { query: "a", tweetCount: 1, genre: "" },
          ],
          otherItems: [{ query: "ちいかわ コラボ", tweetCount: 109, genre: "" }],
        },
      },
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchYahooRealtimeBuzz", () => {
  it("__NEXT_DATA__からitems/otherItemsのqueryを抽出する（1文字ノイズは除外）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(pageWithNextData(NEXT_DATA)) }),
    );
    const terms = await fetchYahooRealtimeBuzz();
    expect(terms).toContainEqual({ term: "弾道ミサイル発射", tweetCount: 194, genre: "ニュース" });
    expect(terms).toContainEqual({ term: "ちいかわ コラボ", tweetCount: 109, genre: "" });
    expect(terms.find((t) => t.term === "a")).toBeUndefined();
  });

  it("__NEXT_DATA__が見つからない場合は空配列を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("<html></html>") }),
    );
    expect(await fetchYahooRealtimeBuzz()).toEqual([]);
  });

  it("fetch失敗時は空配列を返す（Radar全体を止めない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchYahooRealtimeBuzz()).toEqual([]);
  });

  it("HTTPエラーレスポンスも空配列にフォールバックする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await fetchYahooRealtimeBuzz()).toEqual([]);
  });
});
