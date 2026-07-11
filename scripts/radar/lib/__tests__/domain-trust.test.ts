import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isDeniedDomain,
  isTrustedTavilyUrl,
  matchesHostnameOrSubdomain,
  loadDomainTrustDenylist,
  resetDomainTrustDenylistCache,
} from "../domain-trust";

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

  it("DB管理の追加拒否ホスト名も検出する", () => {
    expect(isDeniedDomain("bad-source.example", ["bad-source.example"])).toBe(true);
    expect(isDeniedDomain("sub.bad-source.example", ["bad-source.example"])).toBe(true);
    expect(isDeniedDomain("good-source.example", ["bad-source.example"])).toBe(false);
  });
});

describe("matchesHostnameOrSubdomain", () => {
  it("完全一致とサブドメイン一致をtrueにする", () => {
    expect(matchesHostnameOrSubdomain("example.com", "example.com")).toBe(true);
    expect(matchesHostnameOrSubdomain("sub.example.com", "example.com")).toBe(true);
  });

  it("前方一致だけの誤検出は起こさない（例: notexample.com）", () => {
    expect(matchesHostnameOrSubdomain("notexample.com", "example.com")).toBe(false);
  });

  it("大文字小文字を無視する", () => {
    expect(matchesHostnameOrSubdomain("Example.COM", "example.com")).toBe(true);
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

  it("DB管理の追加拒否ホスト名も反映する", () => {
    expect(isTrustedTavilyUrl("https://bad-source.example/a", ["bad-source.example"])).toBe(false);
  });
});

describe("loadDomainTrustDenylist", () => {
  afterEach(() => {
    resetDomainTrustDenylistCache();
    vi.restoreAllMocks();
  });

  function fakePrisma(hostnames: string[] | (() => Promise<{ hostname: string }[]>)) {
    const findMany =
      typeof hostnames === "function"
        ? vi.fn().mockImplementation(hostnames)
        : vi.fn().mockResolvedValue(hostnames.map((hostname) => ({ hostname })));
    return { domainTrustRule: { findMany } };
  }

  it("DBのDENYルールのホスト名一覧を返す", async () => {
    const prisma = fakePrisma(["bad-source.example"]);
    const result = await loadDomainTrustDenylist(prisma);
    expect(result).toEqual(["bad-source.example"]);
    expect(prisma.domainTrustRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: "DENY" } }),
    );
  });

  it("キャッシュ有効期間内は再度DBを呼ばない", async () => {
    const prisma = fakePrisma(["bad-source.example"]);
    await loadDomainTrustDenylist(prisma);
    await loadDomainTrustDenylist(prisma);
    expect(prisma.domainTrustRule.findMany).toHaveBeenCalledTimes(1);
  });

  it("DB接続に失敗した場合はコード内denylistのみで続行できるよう空配列を返す", async () => {
    const prisma = fakePrisma(() => Promise.reject(new Error("db down")));
    const result = await loadDomainTrustDenylist(prisma);
    expect(result).toEqual([]);
  });

  it("resetDomainTrustDenylistCacheでキャッシュをクリアすると再度DBを呼ぶ", async () => {
    const prisma = fakePrisma(["a.example"]);
    await loadDomainTrustDenylist(prisma);
    resetDomainTrustDenylistCache();
    await loadDomainTrustDenylist(prisma);
    expect(prisma.domainTrustRule.findMany).toHaveBeenCalledTimes(2);
  });
});
