import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  bookmarkFindMany: vi.fn(),
  voteFindMany: vi.fn(),
  issueTimelineFindMany: vi.fn(),
  issueFindMany: vi.fn(),
  getVoteSwing: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    bookmark: { findMany: mocks.bookmarkFindMany },
    vote: { findMany: mocks.voteFindMany },
    issueTimeline: { findMany: mocks.issueTimelineFindMany },
    issue: { findMany: mocks.issueFindMany },
  },
}));

vi.mock("@/lib/vote-swing", () => ({
  getVoteSwing: mocks.getVoteSwing,
}));

import { getFollowedUpdates } from "@/lib/notifications";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindUnique.mockResolvedValue({
    createdAt: new Date("2026-01-01"),
    notificationsCheckedAt: new Date("2026-07-01"),
  });
  mocks.bookmarkFindMany.mockResolvedValue([{ issueId: "issue-standing" }]);
  mocks.voteFindMany.mockResolvedValue([]);
  mocks.issueTimelineFindMany.mockResolvedValue([]);
});

describe("getFollowedUpdates", () => {
  it("続報が無くても、中立層が有意に動いていればswing通知を返す", async () => {
    mocks.issueFindMany.mockResolvedValue([
      { id: "issue-standing", slug: "standing-debate", title: "常設debateの例" },
    ]);
    mocks.getVoteSwing.mockResolvedValue({
      hoursAgo: 3,
      pastPercents: { for: 40, against: 40, undecided: 20 },
      currentPercents: { for: 47, against: 33, undecided: 20 },
      deltaPoints: { for: 7, against: -7, undecided: 0 },
      newVotes: 10,
    });

    const { items } = await getFollowedUpdates("user1");
    expect(items).toHaveLength(1);
    expect(items[0].issueId).toBe("issue-standing");
    expect(items[0].label).toContain("賛成+7pt");
  });

  it("swingが閾値未満(null)なら通知しない", async () => {
    mocks.issueFindMany.mockResolvedValue([
      { id: "issue-standing", slug: "standing-debate", title: "常設debateの例" },
    ]);
    mocks.getVoteSwing.mockResolvedValue(null);

    const { items } = await getFollowedUpdates("user1");
    expect(items).toHaveLength(0);
  });

  it("続報がある争点はswingと重複させず続報側を優先する", async () => {
    mocks.issueTimelineFindMany.mockResolvedValue([
      {
        issueId: "issue-standing",
        label: "続報あり",
        at: new Date("2026-07-10"),
        issue: { slug: "standing-debate", title: "常設debateの例" },
      },
    ]);

    const { items } = await getFollowedUpdates("user1");
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("続報あり");
    // 続報でカバー済みなのでswingチェック自体が走らない
    expect(mocks.getVoteSwing).not.toHaveBeenCalled();
  });
});
