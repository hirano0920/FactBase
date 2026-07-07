import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYahooNewsRankingTitles } from "../yahoo-news-ranking";

// 2026-07-06時点で確認済みのマークアップ構造を模したfixture（本番と同じ入れ子順序）
const RANKING_HTML = `<ol>
<li><a href="https://news.yahoo.co.jp/articles/9663fe946bd5f602da783ee06178b5ff6a4e7adf" class="x"><span class="y">1</span><div class="body"><div class="thumb"><picture><img/></picture></div><div class="wrap"><div class="title">佐藤二朗　ハラスメント騒動で〝豹変〟…業界から心配の声</div></div></div></a></li>
<li><a href="https://news.yahoo.co.jp/articles/0e0f7c7835af5167805f24fc9cabbaee55361fc1" class="x"><span class="y">2</span><div class="body"><div class="thumb"><picture><img/></picture></div><div class="wrap"><div class="title">国会で新法案が審議入り</div></div></div></a></li>
</ol>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchYahooNewsRankingTitles", () => {
  it("国内・経済・国際ランキングから見出しを抽出する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(RANKING_HTML) }),
    );
    const titles = await fetchYahooNewsRankingTitles();
    expect(titles).toContain("佐藤二朗　ハラスメント騒動で〝豹変〟…業界から心配の声");
    expect(titles).toContain("国会で新法案が審議入り");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
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
