import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  politicianVoteGroupBy: vi.fn(),
  politicianVoteEventGroupBy: vi.fn(),
  politicianVoteFindUnique: vi.fn(),
  politicianVoteUpsert: vi.fn(),
  politicianVoteEventCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    politicianVote: {
      groupBy: mocks.politicianVoteGroupBy,
      findUnique: mocks.politicianVoteFindUnique,
      upsert: mocks.politicianVoteUpsert,
    },
    politicianVoteEvent: {
      groupBy: mocks.politicianVoteEventGroupBy,
      create: mocks.politicianVoteEventCreate,
    },
    $transaction: mocks.transaction,
  },
}));

import { getPoliticianSupportStats, castPoliticianVote } from "@/lib/politician-votes";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops));
});

describe("getPoliticianSupportStats", () => {
  it("全体の票数が少なくても総数は表示する（直近1週間データは無ければnull）", async () => {
    mocks.politicianVoteGroupBy.mockResolvedValueOnce([
      { choice: "FOR", _count: { _all: 3 } },
      { choice: "AGAINST", _count: { _all: 2 } },
    ]);
    mocks.politicianVoteEventGroupBy.mockResolvedValueOnce([]);

    const stats = await getPoliticianSupportStats("p1");
    expect(stats.total.n).toBe(5);
    expect(stats.recent).toBeNull();
    expect(stats.deltaPoints).toBeNull();
  });

  it("直近1週間の票数が十分ならスイング（デルタ）を計算する", async () => {
    // 全体: for40 against60 = 40%/60%
    mocks.politicianVoteGroupBy.mockResolvedValueOnce([
      { choice: "FOR", _count: { _all: 40 } },
      { choice: "AGAINST", _count: { _all: 60 } },
    ]);
    // 直近1週間: for8 against2 = 80%/20%（直近は評価するが伸びている）
    mocks.politicianVoteEventGroupBy.mockResolvedValueOnce([
      { choice: "FOR", _count: { _all: 8 } },
      { choice: "AGAINST", _count: { _all: 2 } },
    ]);

    const stats = await getPoliticianSupportStats("p1");
    expect(stats.total.percents.for).toBe(40);
    expect(stats.recent?.percents.for).toBe(80);
    expect(stats.deltaPoints?.for).toBe(40);
  });

  it("直近の票数が閾値未満ならスイングを出さない（ノイズ対策）", async () => {
    mocks.politicianVoteGroupBy.mockResolvedValueOnce([
      { choice: "FOR", _count: { _all: 40 } },
      { choice: "AGAINST", _count: { _all: 60 } },
    ]);
    mocks.politicianVoteEventGroupBy.mockResolvedValueOnce([
      { choice: "FOR", _count: { _all: 3 } },
      { choice: "AGAINST", _count: { _all: 2 } },
    ]);

    const stats = await getPoliticianSupportStats("p1");
    expect(stats.recent).toBeNull();
  });
});

describe("castPoliticianVote", () => {
  it("初回投票は現在状態upsert＋イベントログ作成の両方を行う", async () => {
    mocks.politicianVoteFindUnique.mockResolvedValueOnce(null);
    mocks.politicianVoteGroupBy.mockResolvedValueOnce([{ choice: "FOR", _count: { _all: 1 } }]);
    mocks.politicianVoteEventGroupBy.mockResolvedValueOnce([]);

    await castPoliticianVote("u1", "p1", "for");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("同じ選択への再投票はDBを更新しない（無意味なイベントログの増殖を防ぐ）", async () => {
    mocks.politicianVoteFindUnique.mockResolvedValueOnce({ choice: "FOR" });
    mocks.politicianVoteGroupBy.mockResolvedValueOnce([{ choice: "FOR", _count: { _all: 1 } }]);
    mocks.politicianVoteEventGroupBy.mockResolvedValueOnce([]);

    await castPoliticianVote("u1", "p1", "for");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("選択を変更した場合はDBを更新する", async () => {
    mocks.politicianVoteFindUnique.mockResolvedValueOnce({ choice: "AGAINST" });
    mocks.politicianVoteGroupBy.mockResolvedValueOnce([{ choice: "FOR", _count: { _all: 1 } }]);
    mocks.politicianVoteEventGroupBy.mockResolvedValueOnce([]);

    await castPoliticianVote("u1", "p1", "for");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
