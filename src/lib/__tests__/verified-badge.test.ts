import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    comment: {
      findMany: mocks.findMany,
      groupBy: mocks.groupBy,
    },
  },
}));

import { getComments } from "@/lib/data";

const baseComment = {
  issueId: "i1",
  userId: "u1",
  stance: "FOR",
  body: "本文",
  likeCount: 0,
  dislikeCount: 0,
  helpfulCount: 0,
  isHidden: false,
  moderationStatus: "VISIBLE",
  parentId: null,
  replyCount: 0,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  issue: { category: "POLITICS" },
};

function commentRow(id: string, plan: string, verdict: string | null) {
  return {
    ...baseComment,
    id,
    user: { id: "u1", name: "太郎", plan },
    fcCache: verdict ? { verdict, label: null, reason: "", sourceUrls: [], createdAt: new Date("2026-01-01") } : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgresql://test";
  mocks.groupBy.mockResolvedValue([]);
});

describe("verifiedBadge導出（mapComment内ロジック）", () => {
  it("verdict=TRUE かつ plan=FACTCHECK のとき true", async () => {
    mocks.findMany.mockResolvedValueOnce([commentRow("a", "FACTCHECK", "TRUE")]);
    const page = await getComments("issue-badge-true-pro", undefined, 20, "new");
    expect(page.comments[0].verifiedBadge).toBe(true);
  });

  it("verdict=TRUE かつ plan=COMMENT(Plus) でも true", async () => {
    mocks.findMany.mockResolvedValueOnce([commentRow("b", "COMMENT", "TRUE")]);
    const page = await getComments("issue-badge-true-plus", undefined, 20, "new");
    expect(page.comments[0].verifiedBadge).toBe(true);
  });

  it("plan=FACTCHECK でも verdict=FALSE なら false", async () => {
    mocks.findMany.mockResolvedValueOnce([commentRow("c", "FACTCHECK", "FALSE")]);
    const page = await getComments("issue-badge-false-pro", undefined, 20, "new");
    expect(page.comments[0].verifiedBadge).toBe(false);
  });

  it("FC未実施(fcCache=null)なら plan=FACTCHECK でも false", async () => {
    mocks.findMany.mockResolvedValueOnce([commentRow("d", "FACTCHECK", null)]);
    const page = await getComments("issue-badge-no-fc", undefined, 20, "new");
    expect(page.comments[0].verifiedBadge).toBe(false);
  });
});
