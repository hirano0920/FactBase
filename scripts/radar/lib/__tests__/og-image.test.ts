import { afterEach, describe, expect, it, vi } from "vitest";
import { extractOgImageUrl, fetchArticleThumbnail } from "../og-image";

afterEach(() => vi.unstubAllGlobals());

describe("extractOgImageUrl", () => {
  it("og:imageを抽出する（実際の朝日新聞の記事ページと同じ属性順）", () => {
    const html = `<meta property="og:image" content="https://imgopt.asahi.com/ogp/AS20260616003455_comm.jpg"/>`;
    expect(extractOgImageUrl(html)).toBe("https://imgopt.asahi.com/ogp/AS20260616003455_comm.jpg");
  });

  it("属性順が逆（content先・property後）でも抽出する", () => {
    const html = `<meta content="https://example.com/photo.jpg" property="og:image">`;
    expect(extractOgImageUrl(html)).toBe("https://example.com/photo.jpg");
  });

  it("og:imageが無ければtwitter:imageにフォールバックする", () => {
    const html = `<meta name="twitter:image" content="https://example.com/tw.jpg">`;
    expect(extractOgImageUrl(html)).toBe("https://example.com/tw.jpg");
  });

  it("サイト共通のロゴ・デフォルト画像は弾く（記事固有でない画像を混入させない）", () => {
    expect(extractOgImageUrl(`<meta property="og:image" content="https://example.com/logo.png">`)).toBeNull();
    expect(
      extractOgImageUrl(`<meta property="og:image" content="https://example.com/default-image.jpg">`),
    ).toBeNull();
    expect(extractOgImageUrl(`<meta property="og:image" content="https://example.com/noimage.png">`)).toBeNull();
  });

  it("og:image自体が無ければnull", () => {
    expect(extractOgImageUrl("<html><head></head></html>")).toBeNull();
  });

  it("http/https以外のURL（相対パス等）は無視する", () => {
    expect(extractOgImageUrl(`<meta property="og:image" content="/relative/path.jpg">`)).toBeNull();
  });
});

describe("fetchArticleThumbnail", () => {
  it("最初の候補で成功すれば以降の候補は試さない", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<meta property="og:image" content="https://a.example.com/1.jpg">'),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchArticleThumbnail([
      { url: "https://a.example.com/article1", feed: "A社" },
      { url: "https://b.example.com/article2", feed: "B社" },
    ]);
    expect(result).toEqual({
      thumbnailUrl: "https://a.example.com/1.jpg",
      thumbnailSourceUrl: "https://a.example.com/article1",
      thumbnailSourceFeed: "A社",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("1件目が失敗（HTTPエラー・og:image無し・例外）でも次の候補を試す（確実性優先）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<meta property="og:image" content="https://c.example.com/3.jpg">'),
      });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchArticleThumbnail([
      { url: "https://a.example.com/1", feed: "A社" },
      { url: "https://b.example.com/2", feed: "B社" },
      { url: "https://c.example.com/3", feed: "C社" },
    ]);
    expect(result?.thumbnailSourceFeed).toBe("C社");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("全候補が失敗すればnullを返す（記事公開は止めない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await fetchArticleThumbnail([{ url: "https://a.example.com/1", feed: "A社" }]);
    expect(result).toBeNull();
  });

  it("maxAttemptsを超える候補は試さない", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);
    const candidates = Array.from({ length: 10 }, (_, i) => ({ url: `https://x${i}.example.com`, feed: `F${i}` }));
    await fetchArticleThumbnail(candidates, 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
