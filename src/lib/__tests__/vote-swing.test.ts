import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  voteGroupBy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vote: {
      groupBy: mocks.voteGroupBy,
    },
  },
}));

import { getVoteSwing } from "@/lib/vote-swing";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getVoteSwing", () => {
  it("母数が閾値未満ならnull（ノイズだらけの表示を避ける）", async () => {
    // 過去: for5 against3 undecided2=10 / 現在: for6 against4 undecided2=12（総数が閾値20未満）
    mocks.voteGroupBy
      .mockResolvedValueOnce([
        { choice: "FOR", _count: { _all: 5 } },
        { choice: "AGAINST", _count: { _all: 3 } },
        { choice: "UNDECIDED", _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([
        { choice: "FOR", _count: { _all: 6 } },
        { choice: "AGAINST", _count: { _all: 4 } },
        { choice: "UNDECIDED", _count: { _all: 2 } },
      ]);
    const swing = await getVoteSwing("issue1");
    expect(swing).toBeNull();
  });

  it("新規票数が閾値未満ならnull（総数は十分でも動きが無ければ表示しない）", async () => {
    mocks.voteGroupBy
      .mockResolvedValueOnce([
        { choice: "FOR", _count: { _all: 15 } },
        { choice: "AGAINST", _count: { _all: 10 } },
        { choice: "UNDECIDED", _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { choice: "FOR", _count: { _all: 16 } },
        { choice: "AGAINST", _count: { _all: 10 } },
        { choice: "UNDECIDED", _count: { _all: 3 } },
      ]);
    const swing = await getVoteSwing("issue1");
    expect(swing).toBeNull();
  });

  it("母数・新規票数が十分なら賛否の変化量(pt)を返す", async () => {
    // 過去: for40 against40 undecided20=100 (50%/50%系)
    mocks.voteGroupBy
      .mockResolvedValueOnce([
        { choice: "FOR", _count: { _all: 40 } },
        { choice: "AGAINST", _count: { _all: 40 } },
        { choice: "UNDECIDED", _count: { _all: 20 } },
      ])
      // 現在: for60 against30 undecided20=110（forが伸びている）
      .mockResolvedValueOnce([
        { choice: "FOR", _count: { _all: 60 } },
        { choice: "AGAINST", _count: { _all: 30 } },
        { choice: "UNDECIDED", _count: { _all: 20 } },
      ]);
    const swing = await getVoteSwing("issue1", 3);
    expect(swing).not.toBeNull();
    expect(swing?.newVotes).toBe(10);
    expect(swing?.pastPercents.for).toBe(40);
    expect(swing?.currentPercents.for).toBeCloseTo(54.5, 1);
    expect(swing?.deltaPoints.for).toBeGreaterThan(0);
    expect(swing?.deltaPoints.against).toBeLessThan(0);
  });
});
