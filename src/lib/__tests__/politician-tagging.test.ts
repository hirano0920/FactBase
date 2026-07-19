import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  politicianUpsert: vi.fn(),
  issuePoliticianUpsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    politician: { upsert: mocks.politicianUpsert },
    issuePolitician: { upsert: mocks.issuePoliticianUpsert },
  },
}));

import { tagPoliticiansFromDietVote } from "@/lib/politician-tagging";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.politicianUpsert.mockImplementation(({ create }: { create: { slug: string } }) =>
    Promise.resolve({ id: `pol-${create.slug}` }),
  );
});

describe("tagPoliticiansFromDietVote", () => {
  it("政党は多数派の賛否でstanceを決める", async () => {
    await tagPoliticiansFromDietVote("issue1", {
      parties: [{ party: "自民党", memberCount: 100, for: 80, against: 20 }],
      defectors: [],
    });
    expect(mocks.politicianUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { slug: "自民党", name: "自民党", party: "自民党" } }),
    );
    expect(mocks.issuePoliticianUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { issueId: "issue1", politicianId: "pol-自民党", stance: "FOR", source: "dietVote:party" },
      }),
    );
  });

  it("賛成0・反対0の政党（採決不参加）はタグ付けしない", async () => {
    await tagPoliticiansFromDietVote("issue1", {
      parties: [{ party: "諸派", memberCount: 1, for: 0, against: 0 }],
      defectors: [],
    });
    expect(mocks.politicianUpsert).not.toHaveBeenCalled();
    expect(mocks.issuePoliticianUpsert).not.toHaveBeenCalled();
  });

  it("離反者は党の多数派と別に自分の実際の投票でタグ付けする(棄権も含む)", async () => {
    await tagPoliticiansFromDietVote("issue1", {
      parties: [{ party: "自民党", memberCount: 100, for: 80, against: 20 }],
      defectors: [{ name: "山田太郎", party: "自民党", vote: "abstain", role: null }],
    });
    expect(mocks.issuePoliticianUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          issueId: "issue1",
          politicianId: "pol-山田太郎",
          stance: "ABSTAIN",
          source: "dietVote:defector",
        },
      }),
    );
  });
});
