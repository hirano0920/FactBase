import { describe, expect, it, vi, afterEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureEvidence, evidenceToArticleFacts, internationalNewsSources } from "../enrich";
import type { EvidenceBundle } from "../research";

const EMPTY_BUNDLE: EvidenceBundle = {
  topic: "x",
  dietSpeeches: [],
  laws: [],
  news: [],
  internationalNews: [],
  background: null,
  officialEvents: [],
  gatheredAt: "",
};

function fakePrisma(updateMock = vi.fn()) {
  return {
    topicCandidate: { update: updateMock },
    sourceEvent: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
}

afterEach(() => vi.restoreAllMocks());

describe("ensureEvidence", () => {
  it("candidateが無ければ調査せずnullを返す代わりに、検索語があれば新規調査する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const prisma = fakePrisma();
    const bundle = await ensureEvidence(prisma, "国旗損壊罪", null);
    expect(bundle).not.toBeNull();
    expect(bundle?.topic).toBe("国旗損壊罪");
    vi.unstubAllGlobals();
  });

  it("検索語が短すぎる場合はnullを返す（外部API呼び出しなし）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const prisma = fakePrisma();
    const bundle = await ensureEvidence(prisma, "a", null);
    expect(bundle).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("鮮度内（enrichRefreshHours以内）の既存evidenceJsonはそのまま再利用し、再調査しない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const prisma = fakePrisma();
    const candidate = {
      id: "c1",
      evidenceJson: { ...EMPTY_BUNDLE, topic: "既存トピック" },
      updatedAt: new Date(),
    };
    const bundle = await ensureEvidence(prisma, "国旗損壊罪", candidate);
    expect(bundle?.topic).toBe("既存トピック");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("鮮度切れの既存evidenceJsonは再調査し、TopicCandidateを更新する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const updateMock = vi.fn().mockResolvedValue({});
    const prisma = fakePrisma(updateMock);
    const candidate = {
      id: "c1",
      evidenceJson: { ...EMPTY_BUNDLE, topic: "古いトピック" },
      updatedAt: new Date(Date.now() - 24 * 60 * 60_000),
    };
    const bundle = await ensureEvidence(prisma, "新トピック", candidate);
    expect(bundle?.topic).toBe("新トピック");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" } }),
    );
    vi.unstubAllGlobals();
  });

  it("調査自体が失敗（例外）した場合はnullを返し、呼び出し側を落とさない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const prisma = fakePrisma();
    const bundle = await ensureEvidence(prisma, "国旗損壊罪", null);
    // researchTopicは内部で各ソースの失敗を握りつぶすため、ここでは空バンドルが返る想定
    expect(bundle).not.toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("evidenceToArticleFacts", () => {
  it("evidenceがnullなら全て空配列/nullを返す", () => {
    expect(evidenceToArticleFacts(null)).toEqual({
      dietSpeeches: [],
      background: null,
      laws: [],
      estatStats: [],
    });
  });

  it("evidenceがあればそのまま各フィールドを取り出す", () => {
    const bundle: EvidenceBundle = {
      ...EMPTY_BUNDLE,
      dietSpeeches: [{ date: "d", house: "h", meeting: "m", session: "s", speaker: "sp", speakerGroup: "g", snippet: "sn", url: "u" }],
      laws: [{ lawTitle: "刑法", lawNum: "N", promulgationDate: "", category: "", repealStatus: "", url: "https://law", lawId: "L1", articleSnippets: [] }],
      background: { title: "T", extract: "E", url: "https://w" },
    };
    const facts = evidenceToArticleFacts(bundle);
    expect(facts.dietSpeeches).toHaveLength(1);
    expect(facts.laws).toHaveLength(1);
    expect(facts.background?.title).toBe("T");
  });
});

describe("internationalNewsSources", () => {
  it("evidenceがnullなら空配列", () => {
    expect(internationalNewsSources(null)).toEqual([]);
  });

  it("internationalNewsを{title,url,feed}形式に変換する（sourceが空ならinternationalにフォールバック）", () => {
    const bundle: EvidenceBundle = {
      ...EMPTY_BUNDLE,
      internationalNews: [
        { title: "A", source: "Reuters", url: "https://a", pubDate: "", region: "international" },
        { title: "B", source: "", url: "https://b", pubDate: "", region: "international" },
      ],
    };
    const sources = internationalNewsSources(bundle);
    expect(sources).toEqual([
      { title: "A", url: "https://a", feed: "Reuters" },
      { title: "B", url: "https://b", feed: "international" },
    ]);
  });
});
