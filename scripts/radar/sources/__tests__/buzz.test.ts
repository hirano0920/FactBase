import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeHtmlEntities, fetchHotentryTitles } from "../buzz";

// はてブhotentryのRDF構造を模したfixture
const HOTENTRY_RDF = `<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/">
<channel rdf:about="https://b.hatena.ne.jp/hotentry/social">
  <title>はてなブックマーク - 人気エントリー - 世の中</title>
</channel>
<item rdf:about="https://example.com/a">
  <title>入管法改正案が衆院通過、支援団体から懸念の声</title>
  <link>https://example.com/a</link>
</item>
<item rdf:about="https://example.com/b">
  <title>短い</title>
  <link>https://example.com/b</link>
</item>
<item rdf:about="https://example.com/c">
  <title>&amp;#x6D88;&amp;#x8CBB;&amp;#x7A0E;&amp;#x6E1B;&amp;#x7A0E;&amp;#x3092;&amp;#x5DE1;&amp;#x308B;&amp;#x8B70;&amp;#x8AD6;</title>
  <link>https://example.com/c</link>
</item>
</rdf:RDF>
`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchHotentryTitles", () => {
  it("RDF形式の人気エントリからタイトルを抽出し、極端に短いものは除外する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(HOTENTRY_RDF) }),
    );
    const titles = await fetchHotentryTitles();
    expect(titles).toContain("入管法改正案が衆院通過、支援団体から懸念の声");
    expect(titles).not.toContain("短い");
  });

  it("二重エンコードされたHTML実体参照を日本語にデコードする（照合可能な形に）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(HOTENTRY_RDF) }),
    );
    const titles = await fetchHotentryTitles();
    expect(titles).toContain("消費税減税を巡る議論");
  });
});

describe("decodeHtmlEntities", () => {
  it("16進・10進の数値文字参照と名前付き実体を解決する", () => {
    expect(decodeHtmlEntities("&#x76D7;&#32884;&amp;テスト&quot;引用&quot;")).toBe(
      '盗聴&テスト"引用"',
    );
  });

  it("fetch失敗時は空配列を返す（Radar全体を止めない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchHotentryTitles()).toEqual([]);
  });

  it("HTTPエラーレスポンスも空配列にフォールバックする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await fetchHotentryTitles()).toEqual([]);
  });
});
