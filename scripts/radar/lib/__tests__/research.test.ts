import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  researchTopic,
  isEmptyEvidence,
  evaluateEvidenceSufficiency,
  evaluateBuzzPromoteSufficiency,
  buildResearchSearchTerms,
  classifyTavilyRegion,
  tavilyResultsToNewsItems,
  type EvidenceBundle,
} from "../research";
import { resetDomainTrustDenylistCache } from "../domain-trust";

// 5つの外部APIは実fetchを叩くため、fetchをモックして researchTopic の束ね方だけ検証する
function stubFetch(handler: (url: string) => { ok: boolean; json?: unknown; text?: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      const r = handler(url);
      return Promise.resolve({
        ok: r.ok,
        status: r.ok ? 200 : 500,
        json: () => Promise.resolve(r.json ?? {}),
        text: () => Promise.resolve(r.text ?? ""),
        headers: { get: () => "application/json" },
      });
    }),
  );
}

function fakePrisma(sourceEvents: unknown[] = [], denylistHostnames: string[] = []) {
  return {
    sourceEvent: { findMany: vi.fn().mockResolvedValue(sourceEvents) },
    domainTrustRule: {
      findMany: vi.fn().mockResolvedValue(denylistHostnames.map((hostname) => ({ hostname }))),
    },
  } as unknown as PrismaClient;
}

const LIMITS = { kokkaiRecords: 5, lawRecords: 3, newsRecords: 8, internationalNewsRecords: 5 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetDomainTrustDenylistCache();
});

describe("researchTopic", () => {
  it("5つの外部ソース（国内外ニュース含む）＋既存SourceEventを1バンドルに束ねる", async () => {
    stubFetch((url) => {
      if (url.includes("kokkai")) {
        return {
          ok: true,
          json: {
            speechRecord: [
              { date: "2026-04-10", nameOfHouse: "衆議院", nameOfMeeting: "本会議", speech: "国旗損壊罪について", speechURL: "https://k/1" },
            ],
          },
        };
      }
      if (url.includes("e-gov")) {
        return {
          ok: true,
          json: { laws: [{ law_info: { law_id: "X", law_num: "N" }, revision_info: { law_title: "刑法" } }] },
        };
      }
      if (url.includes("wikipedia") && url.includes("rest_v1")) {
        return { ok: true, json: { title: "国旗損壊罪", extract: "国旗を損壊する行為を処罰する罪。" } };
      }
      // google news（国内・海外の両方がここに来る。hl=en-USなら海外扱い）
      if (url.includes("hl=en-US")) {
        return {
          ok: true,
          text: `<rss><channel><item><title>Editorial on flag law - Japan Times</title><link>https://n/int</link><source url="s">Japan Times</source></item></channel></rss>`,
        };
      }
      return {
        ok: true,
        text: `<rss><channel><item><title>報道A - 佐賀新聞</title><link>https://n/1</link><source url="s">佐賀新聞</source></item></channel></rss>`,
      };
    });
    const prisma = fakePrisma([
      { title: "国旗損壊罪の閣議決定", url: "https://kantei/1", feedName: "kantei", createdAt: new Date(), publishedAt: new Date() },
    ]);

    const bundle = await researchTopic("国旗損壊罪", LIMITS, prisma);
    expect(bundle.topic).toBe("国旗損壊罪");
    expect(bundle.dietSpeeches).toHaveLength(1);
    expect(bundle.laws).toHaveLength(1);
    expect(bundle.news).toHaveLength(1);
    expect(bundle.news[0].region).toBe("domestic");
    expect(bundle.internationalNews.length).toBeGreaterThanOrEqual(1);
    expect(bundle.internationalNews[0].region).toBe("international");
    expect(bundle.internationalNews[0].source).toBe("Japan Times");
    expect(bundle.background?.title).toBe("国旗損壊罪");
    expect(bundle.officialEvents).toHaveLength(1);
    expect(isEmptyEvidence(bundle)).toBe(false);
  });

  it("「トピック 世論調査」でGoogle Newsを検索し、見つかればpollingNewsに含める", async () => {
    const requestedUrls: string[] = [];
    stubFetch((url) => {
      requestedUrls.push(url);
      if (decodeURIComponent(url).includes("世論調査")) {
        return {
          ok: true,
          text: `<rss><channel><item><title>内閣支持率45% - NHK世論調査</title><link>https://n/poll</link><source url="s">NHK</source></item></channel></rss>`,
        };
      }
      return { ok: false };
    });
    const bundle = await researchTopic("国旗損壊罪", LIMITS, fakePrisma([]));
    expect(requestedUrls.some((u) => decodeURIComponent(u).includes("世論調査"))).toBe(true);
    expect(bundle.pollingNews?.[0]?.url).toBe("https://n/poll");
  });

  it("世論調査報道が見つからなければpollingNewsはundefined", async () => {
    stubFetch(() => ({ ok: false }));
    const bundle = await researchTopic("国旗損壊罪", LIMITS, fakePrisma([]));
    expect(bundle.pollingNews).toBeUndefined();
  });

  it("全ソースが失敗しても空バンドルを返し例外を投げない", async () => {
    stubFetch(() => ({ ok: false }));
    const bundle = await researchTopic("国旗損壊罪", LIMITS, fakePrisma([]));
    expect(isEmptyEvidence(bundle)).toBe(true);
  });

  it("官庁一次情報はPRIMARY_SOURCE_FEEDに一致するもの以外を除外する", async () => {
    stubFetch(() => ({ ok: false }));
    const prisma = fakePrisma([
      { title: "国旗損壊罪の報道", url: "https://tabloid/1", feedName: "some-tabloid", createdAt: new Date(), publishedAt: new Date() },
    ]);
    const bundle = await researchTopic("国旗損壊罪", LIMITS, prisma);
    expect(bundle.officialEvents).toHaveLength(0);
  });

  it("Google Newsの件数が十分（4件以上）ならTavilyは呼ばない", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    const tavilyCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("tavily")) {
          tavilyCalls.push(url);
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
        }
        if (url.includes("hl=en-US")) {
          return Promise.resolve({
            ok: true,
            text: () =>
              Promise.resolve(
                `<rss><channel><item><title>A - X</title><link>https://n/1</link><source url="s">X</source></item><item><title>B - Y</title><link>https://n/2</link><source url="s">Y</source></item></channel></rss>`,
              ),
          });
        }
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              `<rss><channel><item><title>C - Z</title><link>https://n/3</link><source url="s">Z</source></item><item><title>D - W</title><link>https://n/4</link><source url="s">W</source></item></channel></rss>`,
            ),
        });
      }),
    );
    await researchTopic("国旗損壊罪", LIMITS, fakePrisma([]));
    expect(tavilyCalls).toHaveLength(0);
  });

  it("Google Newsの件数が少ない（4件未満）ならTavilyで補う", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    const tavilyCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("tavily")) {
          tavilyCalls.push(url);
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [{ title: "Tavily発見記事", url: "https://found.example.com/1", content: "抜粋" }],
              }),
          });
        }
        return Promise.resolve({ ok: false, status: 500 });
      }),
    );
    const bundle = await researchTopic("国旗損壊罪", LIMITS, fakePrisma([]));
    expect(tavilyCalls.length).toBeGreaterThan(0);
    expect(bundle.internationalNews.some((n) => n.url === "https://found.example.com/1")).toBe(true);
  });

  it("Tavilyが拒否リストのドメインを見つけても採用しない", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("tavily")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [{ title: "プロパガンダ記事", url: "https://www.rt.com/news/1", content: "抜粋" }],
              }),
          });
        }
        return Promise.resolve({ ok: false, status: 500 });
      }),
    );
    const bundle = await researchTopic("国旗損壊罪", LIMITS, fakePrisma([]));
    expect(bundle.internationalNews.some((n) => n.url.includes("rt.com"))).toBe(false);
    expect(bundle.news.some((n) => n.url.includes("rt.com"))).toBe(false);
  });

  it("DB管理の追加denylist（DomainTrustRule）に一致するTavily結果も採用しない", async () => {
    vi.stubEnv("TAVILY_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("tavily")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [{ title: "低品質記事", url: "https://bad-source.example/1", content: "抜粋" }],
              }),
          });
        }
        return Promise.resolve({ ok: false, status: 500 });
      }),
    );
    const bundle = await researchTopic(
      "国旗損壊罪",
      LIMITS,
      fakePrisma([], ["bad-source.example"]),
    );
    expect(bundle.internationalNews.some((n) => n.url.includes("bad-source.example"))).toBe(false);
    expect(bundle.news.some((n) => n.url.includes("bad-source.example"))).toBe(false);
  });
});

describe("isEmptyEvidence", () => {
  it("6ソースすべて空ならtrue", () => {
    const empty: EvidenceBundle = {
      topic: "x",
      dietSpeeches: [],
      laws: [],
      news: [],
      internationalNews: [],
      background: null,
      officialEvents: [],
      gatheredAt: "",
    };
    expect(isEmptyEvidence(empty)).toBe(true);
  });

  it("海外報道だけあれば空ではない", () => {
    const b: EvidenceBundle = {
      topic: "x",
      dietSpeeches: [],
      laws: [],
      news: [],
      internationalNews: [{ title: "A", source: "Reuters", url: "https://a", pubDate: "", region: "international" }],
      background: null,
      officialEvents: [],
      gatheredAt: "",
    };
    expect(isEmptyEvidence(b)).toBe(false);
  });
});

describe("evaluateEvidenceSufficiency", () => {
  const base: EvidenceBundle = {
    topic: "x",
    dietSpeeches: [],
    laws: [],
    news: [],
    internationalNews: [],
    background: null,
    officialEvents: [],
    gatheredAt: "",
  };

  it("異なる媒体2件以上の報道があればsufficient（法案系でなくても通る）", () => {
    const b: EvidenceBundle = {
      ...base,
      news: [
        { title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
        { title: "B", source: "朝日", url: "https://b", pubDate: "", region: "domestic" },
      ],
    };
    const suff = evaluateEvidenceSufficiency(b);
    expect(suff.distinctNewsOutlets).toBe(2);
    expect(suff.sufficient).toBe(true);
  });

  it("国内1媒体＋海外1媒体でも異なる媒体2件として合算される", () => {
    const b: EvidenceBundle = {
      ...base,
      news: [{ title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" }],
      internationalNews: [{ title: "B", source: "Reuters", url: "https://b", pubDate: "", region: "international" }],
    };
    const suff = evaluateEvidenceSufficiency(b);
    expect(suff.distinctNewsOutlets).toBe(2);
    expect(suff.bonusSignals).toContain("international");
    expect(suff.sufficient).toBe(true);
  });

  it("同一媒体の複数記事は distinctNewsOutlets を増やさない", () => {
    const b: EvidenceBundle = {
      ...base,
      news: [
        { title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
        { title: "A2", source: "産経", url: "https://a2", pubDate: "", region: "domestic" },
      ],
    };
    expect(evaluateEvidenceSufficiency(b).distinctNewsOutlets).toBe(1);
  });

  it("報道が1媒体でも背景解説（Wikipedia）があればsufficient", () => {
    const b: EvidenceBundle = {
      ...base,
      news: [{ title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" }],
      background: { title: "T", extract: "E", url: "https://w" },
    };
    const suff = evaluateEvidenceSufficiency(b);
    expect(suff.bonusSignals).toContain("background");
    expect(suff.sufficient).toBe(true);
  });

  it("報道1媒体のみ・加点材料なしはsufficient=falseになる", () => {
    const b: EvidenceBundle = {
      ...base,
      news: [{ title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" }],
    };
    expect(evaluateEvidenceSufficiency(b).sufficient).toBe(false);
  });

  it("国会会議録があれば報道0件でもsufficient", () => {
    const b: EvidenceBundle = {
      ...base,
      dietSpeeches: [{ date: "", house: "", meeting: "", session: "", speaker: "", speakerGroup: "", snippet: "", url: "https://k" }],
    };
    const suff = evaluateEvidenceSufficiency(b);
    expect(suff.bonusSignals).toContain("diet");
    expect(suff.sufficient).toBe(true);
  });
});

describe("evaluateBuzzPromoteSufficiency", () => {
  const base: EvidenceBundle = {
    topic: "x",
    dietSpeeches: [],
    laws: [],
    news: [],
    internationalNews: [],
    background: null,
    officialEvents: [],
    gatheredAt: "",
  };

  it("Wikipedia背景+報道1媒体だけでは不可", () => {
    const b: EvidenceBundle = {
      ...base,
      news: [{ title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" }],
      background: { title: "T", extract: "E", url: "https://w" },
    };
    expect(evaluateBuzzPromoteSufficiency(b).sufficient).toBe(false);
    expect(evaluateEvidenceSufficiency(b).sufficient).toBe(true);
  });

  it("異なる媒体2件なら可", () => {
    const b: EvidenceBundle = {
      ...base,
      news: [
        { title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
        { title: "B", source: "朝日", url: "https://b", pubDate: "", region: "domestic" },
      ],
    };
    expect(evaluateBuzzPromoteSufficiency(b).sufficient).toBe(true);
  });
});

describe("buildResearchSearchTerms", () => {
  it("正規化語に加え争点アンカー語を含める", () => {
    const terms = buildResearchSearchTerms("高市首相、NATO首脳会議を欠席");
    expect(terms[0]).toContain("高市");
    expect(terms.some((t) => /nato/i.test(t))).toBe(true);
  });
});

describe("classifyTavilyRegion", () => {
  it("日本のドメインはdomestic判定", () => {
    expect(classifyTavilyRegion("https://www.asahi.co.jp/articles/1")).toBe("domestic");
    expect(classifyTavilyRegion("https://www.mof.go.jp/news")).toBe("domestic");
  });

  it("海外ドメインはinternational判定", () => {
    expect(classifyTavilyRegion("https://www.reuters.com/world/1")).toBe("international");
    expect(classifyTavilyRegion("https://www.bbc.com/news/1")).toBe("international");
  });

  it("不正なURLはinternational扱いにフォールバックする", () => {
    expect(classifyTavilyRegion("not-a-url")).toBe("international");
  });
});

describe("tavilyResultsToNewsItems", () => {
  it("ドメインをsourceとして抽出し、region付きNewsItemに変換する", () => {
    const items = tavilyResultsToNewsItems([
      { title: "国旗損壊罪の解説", url: "https://www.example.co.jp/a", content: "抜粋" },
    ]);
    expect(items).toEqual([
      { title: "国旗損壊罪の解説", source: "example.co.jp", url: "https://www.example.co.jp/a", pubDate: "", region: "domestic" },
    ]);
  });
});
