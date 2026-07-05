import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractText: vi.fn(),
}));
vi.mock("unpdf", () => ({ extractText: mocks.extractText }));

import { fetchPrimaryExcerpts, stripHtmlToText } from "../primary-text";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("stripHtmlToText", () => {
  it("script/styleを除去し可視テキストだけを残す", () => {
    const html = `<html><head><style>body{color:red}</style><script>alert(1)</script></head>
<body><h1>法案の概要</h1><p>この法律は&amp;施行日を定める。</p></body></html>`;
    const text = stripHtmlToText(html);
    expect(text).toContain("法案の概要");
    expect(text).toContain("この法律は&施行日を定める。");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
  });

  it("main要素があればその中身だけを本文として使う（ナビ等を自動的に除外）", () => {
    const html = `<html><body>
<nav><a href="/">サイトメニュー</a><a href="/about">About</a></nav>
<header>官公庁ヘッダー広告枠</header>
<main><h1>法律案の概要</h1><p>施行日は令和8年4月1日とする。</p></main>
<footer>Copyright フッターリンク集</footer>
</body></html>`;
    const text = stripHtmlToText(html);
    expect(text).toContain("法律案の概要");
    expect(text).toContain("施行日は令和8年4月1日とする。");
    expect(text).not.toContain("サイトメニュー");
    expect(text).not.toContain("官公庁ヘッダー広告枠");
    expect(text).not.toContain("フッターリンク集");
  });

  it("main/articleがなければnav/header/footer/asideを除去してから使う", () => {
    const html = `<html><body>
<nav>サイトメニュー</nav>
<div><h1>お知らせ</h1><p>本日、法案が可決されました。</p></div>
<aside>関連リンク一覧</aside>
<footer>フッターリンク集</footer>
</body></html>`;
    const text = stripHtmlToText(html);
    expect(text).toContain("本日、法案が可決されました。");
    expect(text).not.toContain("サイトメニュー");
    expect(text).not.toContain("関連リンク一覧");
    expect(text).not.toContain("フッターリンク集");
  });
});

describe("fetchPrimaryExcerpts", () => {
  const longBody = `<html><body><p>${"本文。".repeat(100)}</p></body></html>`;

  it("一次情報フィード（官公庁等）のURLだけを取得対象にする", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "text/html; charset=utf-8" },
      text: () => Promise.resolve(longBody),
    });
    vi.stubGlobal("fetch", fetchMock);

    const excerpts = await fetchPrimaryExcerpts([
      { title: "官邸発表", url: "https://kantei.example/a", feed: "kantei" },
      { title: "週刊誌報道", url: "https://tabloid.example/b", feed: "bunshun" },
    ]);
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0].url).toBe("https://kantei.example/a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("PDF（content-typeがpdf）はunpdfでテキスト抽出する（法律案要綱・白書等の主要形式）", async () => {
    mocks.extractText.mockResolvedValue({ totalPages: 3, text: "法律案要綱。".repeat(30) });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "application/pdf" },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      }),
    );
    const excerpts = await fetchPrimaryExcerpts([
      { title: "資料PDF", url: "https://mof.example/a.pdf", feed: "mof" },
    ]);
    expect(excerpts).toHaveLength(1);
    expect(excerpts[0].text).toContain("法律案要綱。");
    expect(mocks.extractText).toHaveBeenCalledWith(expect.any(Uint8Array), { mergePages: true });
  });

  it("content-typeが取れなくても.pdf拡張子ならPDFとして抽出する", async () => {
    mocks.extractText.mockResolvedValue({ totalPages: 1, text: "判決文の要旨。".repeat(30) });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "application/octet-stream" },
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      }),
    );
    const excerpts = await fetchPrimaryExcerpts([
      { title: "判決PDF", url: "https://courts.example/hanketsu.pdf", feed: "courts-news" },
    ]);
    expect(excerpts).toHaveLength(1);
  });

  it("HTML・PDFいずれでもないcontent-typeはスキップする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "image/png" },
      }),
    );
    const excerpts = await fetchPrimaryExcerpts([
      { title: "画像", url: "https://mof.example/a.png", feed: "mof" },
    ]);
    expect(excerpts).toEqual([]);
  });

  it("fetch失敗しても記事生成側を止めない（空配列）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const excerpts = await fetchPrimaryExcerpts([
      { title: "官邸発表", url: "https://kantei.example/a", feed: "kantei" },
    ]);
    expect(excerpts).toEqual([]);
  });
});
