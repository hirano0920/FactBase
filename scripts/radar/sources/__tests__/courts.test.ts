import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCourtsNews, fetchCourtsKijitsu } from "../courts";

// 実際の裁判所サイトから取得した構造を模したfixture（2026-07-04時点で確認済みのマークアップ）
const NEWS_HTML = `
<div class="module-news-list">
  <ul class="module-plane-list">
    <li>
      <div class="module-news-list-meta">
        <span class="module-news-pub-time">
          令和8年6月29日
        </span>
      </div>
      <div class="module-news-list-link">
        <p><a title="知財高裁のお知らせ" href="./../ip/tetuduki/folder/index_10.html">知財高裁のお知らせ</a></p>
      </div>
    </li>
    <li>
      <div class="module-news-list-meta">
        <span class="module-news-pub-time">
          令和8年6月25日
        </span>
      </div>
      <div class="module-news-list-link">
        <p><a title="司法統計年報を掲載しました。" href="./../toukei_siryou/index.html" target="_self">司法統計年報を掲載しました。</a></p>
      </div>
    </li>
  </ul>
</div>
`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCourtsNews", () => {
  it("お知らせ一覧から項目を抽出し、相対URLを絶対URLに解決する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(NEWS_HTML) }),
    );

    const items = await fetchCourtsNews();
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("知財高裁のお知らせ");
    expect(items[0].url).toBe("https://www.courts.go.jp/ip/tetuduki/folder/index_10.html");
    expect(items[0].feedName).toBe("courts-news");
    expect(items[1].title).toBe("司法統計年報を掲載しました。");
  });

  it("fetch失敗時は空配列を返す（Radar全体を止めない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const items = await fetchCourtsNews();
    expect(items).toEqual([]);
  });

  it("HTTPエラーレスポンスも空配列にフォールバックする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const items = await fetchCourtsNews();
    expect(items).toEqual([]);
  });
});

describe("fetchCourtsKijitsu", () => {
  it("同じ内容なら同じ指紋（タイトル）を生成する", async () => {
    const html = '<div class="module-sub-page-parts-default-5">開廷期日：7月10日</div></div>';
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(html) }),
    );
    const a = await fetchCourtsKijitsu();
    const b = await fetchCourtsKijitsu();
    expect(a[0].title).toBe(b[0].title);
  });

  it("内容が変われば指紋（タイトル）も変わる", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<div class="module-sub-page-parts-default-5">A</div></div>'),
    });
    const a = await fetchCourtsKijitsu();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('<div class="module-sub-page-parts-default-5">B</div></div>'),
    });
    const b = await fetchCourtsKijitsu();

    expect(a[0].title).not.toBe(b[0].title);
  });
});
