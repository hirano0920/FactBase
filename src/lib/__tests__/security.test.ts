import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// api-helpersは@/auth(next-auth)をimportするが、ここで検証するのは純関数のみ
vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { verifyOrigin, getClientIp } from "@/lib/api-helpers";
import {
  getClientCountryFromHeaders,
  getClientIpFromHeaders,
  isDomesticAccess,
  isDomesticAccessForMiddleware,
  isDomesticAccessForRegistration,
  isDomesticCountry,
  isDomesticCountryForMiddleware,
  isGeoFenceEnabled,
} from "@/lib/geo";
import { sanitizeArticleHtml } from "@/lib/sanitize";

function makeHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers(extra);
}

function makeReq(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

describe("verifyOrigin (CSRF多層防御)", () => {
  it("同一オリジンを許可する", () => {
    const req = makeReq("https://konkyo.jp/api/votes", { origin: "https://konkyo.jp" });
    expect(verifyOrigin(req)).toBe(true);
  });

  it("別オリジンを拒否する", () => {
    const req = makeReq("https://konkyo.jp/api/votes", { origin: "https://evil.example" });
    expect(verifyOrigin(req)).toBe(false);
  });

  it("Origin無し（same-origin fetch等）は許可する", () => {
    const req = makeReq("https://konkyo.jp/api/votes");
    expect(verifyOrigin(req)).toBe(true);
  });

  it("不正な形式のOriginを拒否する", () => {
    const req = makeReq("https://konkyo.jp/api/votes", { origin: "not-a-url" });
    expect(verifyOrigin(req)).toBe(false);
  });

  it("サブドメイン偽装を拒否する", () => {
    const req = makeReq("https://konkyo.jp/api/votes", {
      origin: "https://konkyo.jp.evil.example",
    });
    expect(verifyOrigin(req)).toBe(false);
  });
});

describe("getClientIp", () => {
  it("x-forwarded-forの先頭IPを返す", () => {
    const req = makeReq("https://konkyo.jp/api", {
      "x-forwarded-for": "203.0.113.5, 10.0.0.1",
    });
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("ヘッダーが無ければunknown", () => {
    expect(getClientIp(makeReq("https://konkyo.jp/api"))).toBe("unknown");
  });
});

describe("geo access control", () => {
  const prevEnv = process.env;

  beforeEach(() => {
    process.env = { ...prevEnv, NODE_ENV: "production", GEO_ALLOW_ALL: undefined };
  });

  afterEach(() => {
    process.env = prevEnv;
  });

  it("本番では登録/APIはJPのみ", () => {
    expect(isGeoFenceEnabled()).toBe(true);
    expect(isDomesticCountry("JP")).toBe(true);
    expect(isDomesticCountry("US")).toBe(false);
    expect(isDomesticCountry(null)).toBe(false);
  });

  it("Middlewareは国不明(null)を通す", () => {
    expect(isDomesticCountryForMiddleware(null)).toBe(true);
    expect(isDomesticCountryForMiddleware("JP")).toBe(true);
    expect(isDomesticCountryForMiddleware("US")).toBe(false);
    expect(isDomesticAccessForMiddleware(makeHeaders())).toBe(true);
  });

  it("新規登録は国不明(null)を拒否", () => {
    expect(isDomesticAccessForRegistration(makeHeaders())).toBe(false);
    expect(isDomesticAccessForRegistration(makeHeaders({ "x-vercel-ip-country": "JP" }))).toBe(
      true,
    );
  });

  it("Vercelの国ヘッダーを読む", () => {
    const h = makeHeaders({ "x-vercel-ip-country": "jp" });
    expect(getClientCountryFromHeaders(h)).toBe("JP");
    expect(isDomesticAccess(h)).toBe(true);
  });

  it("Cloudflareの国ヘッダーを読む", () => {
    const h = makeHeaders({ "cf-ipcountry": "JP" });
    expect(getClientCountryFromHeaders(h)).toBe("JP");
  });

  it("getClientIpFromHeadersはx-real-ipを優先", () => {
    const h = makeHeaders({
      "x-real-ip": "203.0.113.1",
      "x-forwarded-for": "198.51.100.2",
    });
    expect(getClientIpFromHeaders(h)).toBe("203.0.113.1");
  });
});

describe("sanitizeArticleHtml (AI生成HTMLのXSS対策)", () => {
  it("scriptタグを除去する", () => {
    const out = sanitizeArticleHtml('<h2>見出し</h2><script>alert("xss")</script>');
    expect(out).toContain("<h2>見出し</h2>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("alert");
  });

  it("イベントハンドラ属性を除去する", () => {
    const out = sanitizeArticleHtml('<p onclick="steal()">本文</p>');
    expect(out).toContain("<p>本文</p>");
    expect(out).not.toContain("onclick");
  });

  it("javascript:スキームのリンクを無害化する", () => {
    const out = sanitizeArticleHtml('<a href="javascript:alert(1)">リンク</a>');
    expect(out).not.toContain("javascript:");
  });

  it("httpリンクも拒否しhttpsのみ許可する", () => {
    const out = sanitizeArticleHtml(
      '<a href="https://elaws.e-gov.go.jp/">e-Gov</a><a href="http://insecure.example/">x</a>',
    );
    expect(out).toContain('href="https://elaws.e-gov.go.jp/"');
    expect(out).not.toContain("insecure.example");
  });

  it("iframe/style/imgを除去する", () => {
    const out = sanitizeArticleHtml(
      '<iframe src="https://evil.example"></iframe><img src="x" onerror="a()"><p>残る</p>',
    );
    expect(out).toBe("<p>残る</p>");
  });

  it("正当な記事構造は維持される", () => {
    const html =
      "<h2>争点はどこか</h2><p>本文です。</p><ul><li>論点1</li></ul><h3>Q. 質問</h3><p>A. 回答</p>";
    expect(sanitizeArticleHtml(html)).toBe(html);
  });
});
