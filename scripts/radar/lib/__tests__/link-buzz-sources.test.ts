import { describe, expect, it, vi } from "vitest";
import { linkBuzzSourcesToIssue } from "../link-buzz-sources";

describe("linkBuzzSourcesToIssue", () => {
  it("報道ソースを SourceEvent として issueId に紐づける", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const findMany = vi.fn().mockResolvedValue([]);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      sourceEvent: { createMany, findMany, updateMany },
    } as unknown as Parameters<typeof linkBuzzSourcesToIssue>[0];

    const result = await linkBuzzSourcesToIssue(
      prisma,
      "issue-1",
      [
        { title: "報道A", url: "https://a", feed: "google-news" },
        { title: "報道B", url: "https://b", feed: "yahoo-news" },
      ],
      "中国 ミサイル",
    );

    expect(result.created).toBe(2);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ issueId: "issue-1", feedName: "google-news" }),
        ]),
        skipDuplicates: true,
      }),
    );
  });

  it("topicTerm に一致する未リンク RSS を既存イベントから紐づける", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([{ id: "se-1" }, { id: "se-2" }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      sourceEvent: { createMany, findMany, updateMany },
    } as unknown as Parameters<typeof linkBuzzSourcesToIssue>[0];

    const result = await linkBuzzSourcesToIssue(prisma, "issue-1", [], "高市首相");
    expect(result.linkedExisting).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["se-1", "se-2"] } },
      data: { issueId: "issue-1" },
    });
  });
});
