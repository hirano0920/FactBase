import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  chunkFindMany: vi.fn(),
  embedCreate: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    issue: { findUnique: mocks.issueFindUnique },
    evidenceChunk: { findMany: mocks.chunkFindMany },
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock("@/lib/openai-client", () => ({
  createOpenAIClient: () => ({
    embeddings: { create: mocks.embedCreate },
  }),
}));

vi.mock("@/lib/redis", () => ({
  fcEmbedKey: (hash: string) => `fc:embed:${hash}`,
  kv: { get: mocks.kvGet, set: mocks.kvSet },
}));

import { retrieveChunks } from "@/lib/rag";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.issueFindUnique.mockResolvedValue({ category: "ECONOMY" });
  mocks.kvGet.mockResolvedValue(null);
  mocks.kvSet.mockResolvedValue(undefined);
  mocks.embedCreate.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
});

describe("retrieveChunks（グローバル検索）", () => {
  it("類似検索が成功すればその結果を返す（pinned優先・category一致ブーストはSQL側）", async () => {
    const now = new Date();
    mocks.queryRaw.mockResolvedValueOnce([
      { id: "c1", sourceName: "消費税法", articleRef: "第29条", text: "本文", sourceUrl: "https://x", updatedAt: now },
    ]);
    const result = await retrieveChunks("issue-1", "主張本文", 3);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
    expect(mocks.chunkFindMany).not.toHaveBeenCalled();
  });

  it("類似検索が空ならグローバルfindManyにフォールバックする", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    mocks.chunkFindMany.mockResolvedValueOnce([]); // pinned
    mocks.chunkFindMany.mockResolvedValueOnce([
      { id: "c2", sourceName: "日本銀行法", articleRef: null, text: "本文2", sourceUrl: "https://y", updatedAt: new Date() },
    ]); // rest（category一致）
    const result = await retrieveChunks("issue-1", "主張本文", 3);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2");

    // pinnedクエリ: issueEvidenceLinkでpinned=trueに限定
    expect(mocks.chunkFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        issueLinks: { some: { issueId: "issue-1", pinned: true } },
      }),
    }));
    // restクエリ: category配列にIssue.categoryが含まれるものに絞る
    expect(mocks.chunkFindMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ category: { has: "ECONOMY" } }),
    }));
  });

  it("類似検索がAPIエラーで失敗してもフォールバックする", async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error("pgvector error"));
    mocks.chunkFindMany.mockResolvedValueOnce([]);
    mocks.chunkFindMany.mockResolvedValueOnce([]);
    const result = await retrieveChunks("issue-1", "主張本文", 3);
    expect(result).toEqual([]);
  });

  it("pinnedチャンクだけでlimitに達したらrestは問い合わせない", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    mocks.chunkFindMany.mockResolvedValueOnce([
      { id: "p1", sourceName: "消費税法", articleRef: null, text: "pinned", sourceUrl: "https://p", updatedAt: new Date() },
    ]);
    const result = await retrieveChunks("issue-1", "主張本文", 1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("p1");
    expect(mocks.chunkFindMany).toHaveBeenCalledTimes(1);
  });
});
