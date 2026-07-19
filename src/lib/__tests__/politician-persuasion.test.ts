import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  politicianFindUnique: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    politician: { findUnique: mocks.politicianFindUnique },
    $queryRaw: mocks.queryRaw,
  },
}));

import { getPoliticianPersuasionScore } from "@/lib/politician-persuasion";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPoliticianPersuasionScore", () => {
  it("存在しないpoliticianIdはnull", async () => {
    mocks.politicianFindUnique.mockResolvedValue(null);
    const score = await getPoliticianPersuasionScore("nope");
    expect(score).toBeNull();
  });

  it("タグ付け争点が0件ならissueCount=0・bridgingRate=null", async () => {
    mocks.politicianFindUnique.mockResolvedValue({
      id: "p1",
      name: "議員A",
      party: "テスト党",
      issues: [],
    });
    const score = await getPoliticianPersuasionScore("p1");
    expect(score).toEqual({
      politicianId: "p1",
      name: "議員A",
      party: "テスト党",
      issueCount: 0,
      totalHelpful: 0,
      bridgingHelpful: 0,
      bridgingRate: null,
    });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("helpfulが十分ならbridgingRateを計算する", async () => {
    mocks.politicianFindUnique.mockResolvedValue({
      id: "p1",
      name: "議員A",
      party: "テスト党",
      issues: [
        { issueId: "issue1", stance: "FOR" },
        { issueId: "issue2", stance: "AGAINST" },
      ],
    });
    mocks.queryRaw.mockResolvedValue([{ total_helpful: BigInt(20), bridging_helpful: BigInt(8) }]);

    const score = await getPoliticianPersuasionScore("p1");
    expect(score?.issueCount).toBe(2);
    expect(score?.totalHelpful).toBe(20);
    expect(score?.bridgingHelpful).toBe(8);
    expect(score?.bridgingRate).toBe(40);
  });

  it("helpfulが閾値未満ならbridgingRate=null(ノイズ防止)", async () => {
    mocks.politicianFindUnique.mockResolvedValue({
      id: "p1",
      name: "議員A",
      party: null,
      issues: [{ issueId: "issue1", stance: "FOR" }],
    });
    mocks.queryRaw.mockResolvedValue([{ total_helpful: BigInt(2), bridging_helpful: BigInt(1) }]);

    const score = await getPoliticianPersuasionScore("p1");
    expect(score?.bridgingRate).toBeNull();
  });

  it("ABSTAIN(棄権)は集計から除外する(Comment.stance側に対応する陣営が無いため)", async () => {
    mocks.politicianFindUnique.mockResolvedValue({
      id: "p1",
      name: "議員A",
      party: null,
      issues: [{ issueId: "issue1", stance: "ABSTAIN" }],
    });

    const score = await getPoliticianPersuasionScore("p1");
    expect(score?.issueCount).toBe(1);
    expect(score?.bridgingRate).toBeNull();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
