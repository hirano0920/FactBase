import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  voteGroupBy: vi.fn(),
  commentGroupBy: vi.fn(),
  issueFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vote: { groupBy: mocks.voteGroupBy },
    comment: { groupBy: mocks.commentGroupBy },
    issue: { findMany: mocks.issueFindMany },
  },
}));
vi.mock("@/lib/cache-invalidate", () => ({
  invalidateOnCommentCreated: vi.fn(),
  invalidateOnIssueChanged: vi.fn(),
}));
vi.mock("@/lib/radar-publish-held", () => ({ publishHeldRadarCandidate: vi.fn() }));

import { listSurgingIssues } from "@/lib/moderation-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listSurgingIssues", () => {
  it("投票+コメント×2の降順でスコアリングする（コメントは事故リスクが高いため重み2倍）", async () => {
    mocks.voteGroupBy.mockResolvedValueOnce([
      { issueId: "a", _count: { _all: 10 } }, // score 10
      { issueId: "b", _count: { _all: 2 } }, // score 2 + 3*2=8
    ]);
    mocks.commentGroupBy.mockResolvedValueOnce([{ issueId: "b", _count: { _all: 3 } }]);
    mocks.issueFindMany.mockResolvedValueOnce([
      { id: "a", slug: "issue-a", title: "争点A", track: "DEBATE", underReview: false },
      { id: "b", slug: "issue-b", title: "争点B", track: "NEWS", underReview: false },
    ]);

    const result = await listSurgingIssues();
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result[0].surgeScore).toBe(10);
    expect(result[1].surgeScore).toBe(2 + 3 * 2);
  });

  it("投票・コメントが両方無い期間は空配列を返す", async () => {
    mocks.voteGroupBy.mockResolvedValueOnce([]);
    mocks.commentGroupBy.mockResolvedValueOnce([]);
    const result = await listSurgingIssues();
    expect(result).toEqual([]);
    expect(mocks.issueFindMany).not.toHaveBeenCalled();
  });

  it("limitで上位件数に絞る", async () => {
    mocks.voteGroupBy.mockResolvedValueOnce([
      { issueId: "a", _count: { _all: 10 } },
      { issueId: "b", _count: { _all: 5 } },
    ]);
    mocks.commentGroupBy.mockResolvedValueOnce([]);
    mocks.issueFindMany.mockResolvedValueOnce([
      { id: "a", slug: "issue-a", title: "争点A", track: "DEBATE", underReview: false },
    ]);

    const result = await listSurgingIssues(6, 1);
    expect(mocks.issueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["a"] } } }),
    );
    expect(result).toHaveLength(1);
  });
});
