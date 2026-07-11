import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  voteEventFindMany: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    voteEvent: {
      findMany: mocks.voteEventFindMany,
    },
  },
}));

vi.mock("@/lib/redis", () => ({
  kv: {
    get: mocks.kvGet,
    set: mocks.kvSet,
  },
}));

import { getIssueAnalytics } from "@/lib/analytics";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.kvGet.mockResolvedValue(null);
  mocks.kvSet.mockResolvedValue(undefined);
});

describe("getIssueAnalytics", () => {
  it("BEFORE_READとAFTER_READが揃ったユーザーだけをshiftの母数にする", async () => {
    mocks.voteEventFindMany.mockResolvedValue([
      { userId: "u1", phase: "BEFORE_READ", choice: "FOR", intensity: null },
      { userId: "u1", phase: "AFTER_READ", choice: "AGAINST", intensity: -50 },
      { userId: "u2", phase: "BEFORE_READ", choice: "AGAINST", intensity: null },
      // u3はBEFORE_READのみ(未読了) → 母数に含めない
      { userId: "u3", phase: "BEFORE_READ", choice: "FOR", intensity: null },
    ]);

    const result = await getIssueAnalytics("issue-1");

    expect(result.shift.n).toBe(1);
    expect(result.shift.shiftedCount).toBe(1);
    expect(result.afterReadN).toBe(1);
    expect(result.histogram.reduce((sum, b) => sum + b.count, 0)).toBe(1);
  });

  it("イベントが無ければn=0でヒストグラムは全bin空", async () => {
    mocks.voteEventFindMany.mockResolvedValue([]);

    const result = await getIssueAnalytics("issue-empty");

    expect(result.shift).toEqual({ n: 0, shiftedCount: 0, shiftPercent: 0 });
    expect(result.afterReadN).toBe(0);
    expect(result.histogram.every((b) => b.count === 0)).toBe(true);
  });

  it("キャッシュ済みならDBを叩かず返す", async () => {
    mocks.kvGet.mockResolvedValue(
      JSON.stringify({
        shift: { n: 5, shiftedCount: 2, shiftPercent: 40 },
        histogram: [],
        afterReadN: 5,
      }),
    );

    const result = await getIssueAnalytics("issue-cached");

    expect(result.shift.n).toBe(5);
    expect(mocks.voteEventFindMany).not.toHaveBeenCalled();
  });
});
