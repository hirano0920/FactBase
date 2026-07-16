import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractYahooRankingTitles,
  extractYahooRankingEntries,
  fetchYahooNewsRankingTitles,
  fetchYahooCommentRankingTitles,
  fetchYahooCommentRankingEntries,
  fetchYahooArticleCommentCount,
  fetchYahooArticleComments,
} from "../yahoo-news-ranking";

// 旧マークアップ（div）と新マークアップ（p）の両方
const RANKING_HTML_DIV = `<ol>
<li><a href="https://news.yahoo.co.jp/articles/9663fe946bd5f602da783ee06178b5ff6a4e7adf" class="x"><span class="y">1</span><div class="body"><div class="thumb"><picture><img/></picture></div><div class="wrap"><div class="title">佐藤二朗　ハラスメント騒動で〝豹変〟…業界から心配の声</div></div></div></a></li>
<li><a href="https://news.yahoo.co.jp/articles/0e0f7c7835af5167805f24fc9cabbaee55361fc1" class="x"><span class="y">2</span><div class="body"><div class="thumb"><picture><img/></picture></div><div class="wrap"><div class="title">国会で新法案が審議入り</div></div></div></a></li>
</ol>`;

const RANKING_HTML_P = `<a href="https://news.yahoo.co.jp/articles/372e05614515dea31184322e36aaca060cab9c89" class="x"><span>1</span><div><p class="sc-1t7ra5j-7 jYbJVt">「なんで口外したの？」佐藤二朗　橋本愛とのトラブルを“友人に相談していた”が物議</p></div></a>`;

const RANKING_HTML_JSON = `{"list":[{"rankingNumber":1,"headline":"渡辺えり、ハラスメント騒動で橋本愛を \\"擁護\\" も…","newsLink":"https://news.yahoo.co.jp/articles/abc"}]}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractYahooRankingTitles", () => {
  it("div 見出しを抽出する", () => {
    expect(extractYahooRankingTitles(RANKING_HTML_DIV)).toEqual([
      "佐藤二朗　ハラスメント騒動で〝豹変〟…業界から心配の声",
      "国会で新法案が審議入り",
    ]);
  });

  it("p 見出し（エンタメ新マークアップ）を抽出する", () => {
    expect(extractYahooRankingTitles(RANKING_HTML_P)).toContain(
      "「なんで口外したの？」佐藤二朗　橋本愛とのトラブルを“友人に相談していた”が物議",
    );
  });

  it("埋め込み JSON の headline を抽出する", () => {
    expect(extractYahooRankingTitles(RANKING_HTML_JSON)).toContain(
      '渡辺えり、ハラスメント騒動で橋本愛を "擁護" も…',
    );
  });
});

describe("fetchYahooNewsRankingTitles", () => {
  it("国内・経済・国際・エンタメランキングから見出しを抽出する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(RANKING_HTML_DIV) }),
    );
    const titles = await fetchYahooNewsRankingTitles();
    expect(titles).toContain("佐藤二朗　ハラスメント騒動で〝豹変〟…業界から心配の声");
    expect(titles).toContain("国会で新法案が審議入り");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/entertainment"))).toBe(true);
    expect(urls.some((u) => u.includes("/society"))).toBe(false);
  });

  it("マークアップにマッチしない場合は空配列を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("<html></html>") }),
    );
    expect(await fetchYahooNewsRankingTitles()).toEqual([]);
  });

  it("fetch失敗時は空配列を返す（Radar全体を止めない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchYahooNewsRankingTitles()).toEqual([]);
  });

  it("HTTPエラーレスポンスも空配列にフォールバックする", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await fetchYahooNewsRankingTitles()).toEqual([]);
  });
});

describe("fetchYahooCommentRankingTitles", () => {
  it("コメントランキング4カテゴリから見出しを抽出する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(RANKING_HTML_DIV) }),
    );
    const titles = await fetchYahooCommentRankingTitles();
    expect(titles).toContain("佐藤二朗　ハラスメント騒動で〝豹変〟…業界から心配の声");
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes("/ranking/comment/"))).toBe(true);
    expect(urls).toHaveLength(4);
  });

  it("fetch失敗時は空配列を返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchYahooCommentRankingTitles()).toEqual([]);
  });
});

describe("extractYahooRankingEntries", () => {
  it("title/urlペアを抽出する", () => {
    const entries = extractYahooRankingEntries(RANKING_HTML_DIV);
    expect(entries).toEqual([
      {
        title: "佐藤二朗　ハラスメント騒動で〝豹変〟…業界から心配の声",
        url: "https://news.yahoo.co.jp/articles/9663fe946bd5f602da783ee06178b5ff6a4e7adf",
      },
      {
        title: "国会で新法案が審議入り",
        url: "https://news.yahoo.co.jp/articles/0e0f7c7835af5167805f24fc9cabbaee55361fc1",
      },
    ]);
  });

  it("同一URLは重複させない", () => {
    const html = RANKING_HTML_DIV + RANKING_HTML_DIV;
    expect(extractYahooRankingEntries(html)).toHaveLength(2);
  });
});

describe("fetchYahooCommentRankingEntries", () => {
  it("4カテゴリ分をtitle/urlペアで集約し重複を除く", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(RANKING_HTML_DIV) }),
    );
    const entries = await fetchYahooCommentRankingEntries();
    expect(entries).toHaveLength(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  });

  it("fetch失敗時は空配列を返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchYahooCommentRankingEntries()).toEqual([]);
  });
});

describe("fetchYahooArticleCommentCount", () => {
  it("記事ページのtotalCommentCountを取得する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('...{"totalCommentCount":8179}...'),
      }),
    );
    expect(await fetchYahooArticleCommentCount("https://news.yahoo.co.jp/articles/x")).toBe(8179);
  });

  it("パターンが見つからなければnullを返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("<html></html>") }),
    );
    expect(await fetchYahooArticleCommentCount("https://news.yahoo.co.jp/articles/x")).toBeNull();
  });

  it("HTTPエラー・fetch失敗時はnullを返す（Radar全体を止めない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchYahooArticleCommentCount("https://news.yahoo.co.jp/articles/x")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchYahooArticleCommentCount("https://news.yahoo.co.jp/articles/x")).toBeNull();
  });
});

describe("fetchYahooArticleComments", () => {
  // 2026-07-15にnews.yahoo.co.jp/articles/{id}/commentsで実際に確認した構造の縮小版
  const samplePage = (state: unknown) =>
    `<html><body><script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)};</script></body></html>`;

  it("__PRELOADED_STATE__のuserCommentListから本文と反応数を抽出する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            samplePage({
              commentFull: {
                userCommentList: [
                  {
                    text: "副首都はあっても良いとは思うが大阪はない",
                    empathyCount: 998,
                    insightCount: 185,
                    negativeCount: 281,
                  },
                  { text: "首都機能の補完は重要だと思うけど一箇所は反対" }, // 反応数フィールド無し→0扱い
                  { text: "短い" }, // 10字未満は除外される
                ],
              },
            }),
          ),
      }),
    );
    const comments = await fetchYahooArticleComments("https://news.yahoo.co.jp/articles/abc123");
    expect(comments).toEqual([
      {
        text: "副首都はあっても良いとは思うが大阪はない",
        empathyCount: 998,
        insightCount: 185,
        negativeCount: 281,
      },
      {
        text: "首都機能の補完は重要だと思うけど一箇所は反対",
        empathyCount: 0,
        insightCount: 0,
        negativeCount: 0,
      },
    ]);
  });

  it("__PRELOADED_STATE__が無ければ空配列", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("<html></html>") }),
    );
    expect(await fetchYahooArticleComments("https://news.yahoo.co.jp/articles/abc123")).toEqual([]);
  });

  it("HTTPエラー・fetch失敗時は空配列を返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchYahooArticleComments("https://news.yahoo.co.jp/articles/abc123")).toEqual([]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchYahooArticleComments("https://news.yahoo.co.jp/articles/abc123")).toEqual([]);
  });
});
