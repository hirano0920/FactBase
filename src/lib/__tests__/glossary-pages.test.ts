import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));
vi.mock("@/lib/data", () => ({ isDbEnabled: () => true }));

import { listGlossaryTerms, getGlossaryPage } from "@/lib/glossary-pages";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listGlossaryTerms", () => {
  it("出現件数の降順で用語一覧を返す", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { term: "GPIF", count: 5n },
      { term: "乖離許容幅", count: 2n },
    ]);
    const terms = await listGlossaryTerms();
    expect(terms).toEqual([
      { term: "GPIF", issueCount: 5 },
      { term: "乖離許容幅", issueCount: 2 },
    ]);
  });

  it("term が null/空の行は除外する", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ term: null, count: 1n }, { term: "GPIF", count: 5n }]);
    const terms = await listGlossaryTerms();
    expect(terms).toEqual([{ term: "GPIF", issueCount: 5 }]);
  });
});

describe("getGlossaryPage", () => {
  it("該当行が無ければnullを返す", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    const page = await getGlossaryPage("存在しない用語");
    expect(page).toBeNull();
  });

  it("最新記事のglossary定義を採用し、出現する争点一覧を返す", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        slug: "issue-1",
        title: "争点1",
        track: "DEBATE",
        glossaryJson: [{ term: "GPIF", matchText: "GPIF", def: "年金基金", source: "wikipedia", wikipediaUrl: "https://ja.wikipedia.org/wiki/GPIF" }],
      },
      { slug: "issue-2", title: "争点2", track: "NEWS", glossaryJson: [] },
    ]);
    const page = await getGlossaryPage("GPIF");
    expect(page?.def).toBe("年金基金");
    expect(page?.source).toBe("wikipedia");
    expect(page?.issues).toEqual([
      { slug: "issue-1", title: "争点1", track: "debate" },
      { slug: "issue-2", title: "争点2", track: "news" },
    ]);
  });

  it("最新記事のglossaryJsonに該当termが無ければnullを返す", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { slug: "issue-1", title: "争点1", track: "DEBATE", glossaryJson: [{ term: "別の用語", matchText: "x", def: "x", source: "ai" }] },
    ]);
    const page = await getGlossaryPage("GPIF");
    expect(page).toBeNull();
  });
});
