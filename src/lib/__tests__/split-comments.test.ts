import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  issueFindUnique: vi.fn(),
  generateSteelman: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    comment: {
      findMany: mocks.findMany,
      groupBy: mocks.groupBy,
    },
    issue: {
      findUnique: mocks.issueFindUnique,
    },
  },
}));

vi.mock("@/lib/ai", () => ({
  generateSteelman: mocks.generateSteelman,
}));

import { getSplitComments, getDebateHighlights } from "@/lib/data";

const baseComment = {
  issueId: "i1",
  userId: "u1",
  body: "本文",
  likeCount: 0,
  dislikeCount: 0,
  isHidden: false,
  moderationStatus: "VISIBLE",
  parentId: null,
  replyCount: 0,
  updatedAt: new Date("2026-01-01"),
  user: { id: "u1", name: "太郎", plan: "FREE" },
  fcCache: null,
  issue: { category: "POLITICS" },
};

function candidateRow(id: string, helpfulCount: number, crossHelpful: number, createdAt: string) {
  return { id, helpfulCount, crossHelpful, createdAt: new Date(createdAt) };
}

beforeEach(() => {
  // Redisはメモリfallbackのプロセス内シングルトンなのでキャッシュキー衝突を避けるため
  // 各テストで別issueIdを使う。mockResolvedValueOnceの取りこぼし(キャッシュヒットでDB未呼び出し)が
  // 次のテストに漏れないようresetAllMocksで実装ごとリセットする
  vi.resetAllMocks();
  process.env.DATABASE_URL = "postgresql://test";
  mocks.groupBy.mockResolvedValue([]);
  // デフォルトはissue不在扱い＝AIスティールマン生成は走らせず、既存の「空カラムは空のまま」挙動を維持する
  mocks.issueFindUnique.mockResolvedValue(null);
});

describe("getSplitComments", () => {
  it("crossHelpfulの多いコメントが上位に来るよう並べ替えてFOR/AGAINSTを返す", async () => {
    // FOR側: b(cross多い)がa(cross少ない)より上位になるはず
    mocks.queryRaw
      .mockResolvedValueOnce([
        candidateRow("a", 5, 0, "2026-01-01"),
        candidateRow("b", 5, 5, "2026-01-02"),
      ])
      .mockResolvedValueOnce([]); // AGAINST側は0件

    mocks.findMany.mockResolvedValueOnce([
      { ...baseComment, id: "a", stance: "FOR", helpfulCount: 5, createdAt: new Date("2026-01-01") },
      { ...baseComment, id: "b", stance: "FOR", helpfulCount: 5, createdAt: new Date("2026-01-02") },
    ]);

    const result = await getSplitComments("issue-cross-sort", { limit: 20 });

    expect(result.for.comments.map((c) => c.id)).toEqual(["b", "a"]);
    expect(result.against.comments).toEqual([]);
  });

  it("越境評価バッジ表示用にcrossHelpfulを各コメントに含めて返す", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([candidateRow("a", 5, 3, "2026-01-01")])
      .mockResolvedValueOnce([]);
    mocks.findMany.mockResolvedValueOnce([
      { ...baseComment, id: "a", stance: "FOR", helpfulCount: 5, createdAt: new Date("2026-01-01") },
    ]);

    const result = await getSplitComments("issue-cross-helpful-field", { limit: 20 });

    expect(result.for.comments[0].crossHelpful).toBe(3);
  });

  it("空の列はissueが見つからなければ空配列のまま（DBの追加コメントクエリは発行しない）", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await getSplitComments("issue-empty", { limit: 20 });

    expect(result.for).toEqual({ comments: [], nextCursor: null });
    expect(result.against).toEqual({ comments: [], nextCursor: null });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("空の列はAIスティールマンで埋める（コールドスタート対策）", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mocks.issueFindUnique.mockResolvedValue({
      title: "テスト争点",
      summaryJson: { lead: "リード文", bullets: ["論点1"] },
    });
    mocks.generateSteelman.mockImplementation(({ stance }: { stance: "for" | "against" }) =>
      Promise.resolve(stance === "for" ? "賛成側の代弁" : "反対側の代弁"),
    );

    const result = await getSplitComments("issue-steelman", { limit: 20 });

    expect(result.for.comments).toHaveLength(1);
    expect(result.for.comments[0].isAiSteelman).toBe(true);
    expect(result.for.comments[0].body).toBe("賛成側の代弁");
    expect(result.for.comments[0].stance).toBe("for");
    expect(result.against.comments[0].body).toBe("反対側の代弁");
    // スティールマンは仮想コメントなのでDBの通常コメント取得は発行しない
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("load more（カーソルあり）のカラムはスティールマンを生成しない（カーソル無しの側は生成する）", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mocks.issueFindUnique.mockResolvedValue({
      title: "テスト争点",
      summaryJson: { lead: "リード", bullets: [] },
    });
    mocks.generateSteelman.mockResolvedValue("代弁");

    const result = await getSplitComments("issue-steelman-cursor", {
      limit: 20,
      forCursor: "some-cursor",
    });

    // forはload more扱いなので空のまま。against(カーソル無し)は生成対象になる
    expect(result.for.comments).toEqual([]);
    expect(mocks.generateSteelman).toHaveBeenCalledTimes(1);
    expect(mocks.generateSteelman).toHaveBeenCalledWith(expect.objectContaining({ stance: "against" }));
  });

  it("limitを超える件数があるときnextCursorを返す", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([
        candidateRow("a", 1, 0, "2026-01-03"),
        candidateRow("b", 1, 0, "2026-01-02"),
        candidateRow("c", 1, 0, "2026-01-01"),
      ])
      .mockResolvedValueOnce([]);

    mocks.findMany.mockResolvedValueOnce([
      { ...baseComment, id: "a", stance: "FOR", helpfulCount: 1, createdAt: new Date("2026-01-03") },
      { ...baseComment, id: "b", stance: "FOR", helpfulCount: 1, createdAt: new Date("2026-01-02") },
    ]);

    const result = await getSplitComments("issue-cursor", { limit: 2 });

    expect(result.for.comments.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.for.nextCursor).toBe("b");
  });
});

describe("getDebateHighlights", () => {
  it("越境評価スコア(bridging)が最上位のコメントを代表意見として返す（生helpfulCount順ではない）", async () => {
    // FOR側: bはhelpfulCount5だが全て同陣営、aはhelpfulCount5のうち3件が越境 → aの方がbridgingスコアが高い
    mocks.queryRaw
      .mockResolvedValueOnce([
        candidateRow("a", 5, 3, "2026-01-01"),
        candidateRow("b", 5, 0, "2026-01-02"),
      ])
      .mockResolvedValueOnce([]);
    mocks.findMany.mockResolvedValueOnce([
      { ...baseComment, id: "a", stance: "FOR", helpfulCount: 5, createdAt: new Date("2026-01-01") },
    ]);

    const result = await getDebateHighlights("issue-highlights-bridging");

    expect(result.for?.id).toBe("a");
    expect(result.against).toBeNull();
  });

  it("helpfulCount=0のトップコメントは代表意見なし扱いにする", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([candidateRow("a", 0, 0, "2026-01-01")])
      .mockResolvedValueOnce([]);
    mocks.findMany.mockResolvedValueOnce([
      { ...baseComment, id: "a", stance: "FOR", helpfulCount: 0, createdAt: new Date("2026-01-01") },
    ]);

    const result = await getDebateHighlights("issue-highlights-zero");

    expect(result.for).toBeNull();
  });
});
