import { describe, expect, it } from "vitest";
import { isDeniedDomain, isTrustedTavilyUrl } from "../domain-trust";

describe("isDeniedDomain", () => {
  it("既知の国家プロパガンダ系ドメインを検出する", () => {
    expect(isDeniedDomain("rt.com")).toBe(true);
    expect(isDeniedDomain("www.tass.com")).toBe(true);
    expect(isDeniedDomain("sputniknews.com")).toBe(true);
  });

  it("怪しいTLDのドメインを検出する", () => {
    expect(isDeniedDomain("news-site.xyz")).toBe(true);
    expect(isDeniedDomain("cheap-content.top")).toBe(true);
  });

  it("正当なドメインは通す", () => {
    expect(isDeniedDomain("www.reuters.com")).toBe(false);
    expect(isDeniedDomain("asahi.co.jp")).toBe(false);
  });

  it("部分一致で誤検出しない（例: notrt.com のようなドメイン）", () => {
    expect(isDeniedDomain("notrt.com")).toBe(false);
  });
});

describe("isTrustedTavilyUrl", () => {
  it("拒否リストに無いURLは信頼できると判定する", () => {
    expect(isTrustedTavilyUrl("https://www.reuters.com/world/article")).toBe(true);
  });

  it("拒否リストのドメインはfalseを返す", () => {
    expect(isTrustedTavilyUrl("https://www.rt.com/news/1")).toBe(false);
  });

  it("不正なURLはfalseにフォールバックする", () => {
    expect(isTrustedTavilyUrl("not-a-url")).toBe(false);
  });
});
