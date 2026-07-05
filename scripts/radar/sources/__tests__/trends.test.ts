import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTrendingKeywords } from "../trends";

const TRENDS_RSS = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
<title>Daily Search Trends</title>
<item>
  <title>入管法改正</title>
  <ht:approx_traffic>200000+</ht:approx_traffic>
</item>
<item>
  <title>外国人参政権</title>
  <ht:approx_traffic>100000+</ht:approx_traffic>
</item>
<item>
  <title>a</title>
</item>
</channel>
</rss>
`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchTrendingKeywords", () => {
  it("急上昇ワードのタイトルを抽出する（1文字のノイズは除外）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(TRENDS_RSS) }),
    );
    const keywords = await fetchTrendingKeywords();
    expect(keywords).toContain("入管法改正");
    expect(keywords).toContain("外国人参政権");
    expect(keywords).not.toContain("a");
  });

  it("fetch失敗時は空配列を返す（Radar全体を止めない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchTrendingKeywords()).toEqual([]);
  });

  it("HTTPエラーレスポンスも空配列にフォールバックする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await fetchTrendingKeywords()).toEqual([]);
  });
});
