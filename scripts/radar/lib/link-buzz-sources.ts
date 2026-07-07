/**
 * バズ経路（promote）で公開した Issue を followup.ts が追跡できるよう、
 * 調査で集めた報道・官公庁ソースを SourceEvent に紐づける。
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { extractBuzzMatchTokens } from "../../../src/lib/buzz-cross-match";
import { PRIMARY_SOURCE_FEED } from "../../../src/lib/radar";

const BUZZ_NEWS_TRUST = 45;
const LINK_LOOKBACK_DAYS = 14;
const MAX_MATCHING_RSS = 25;

export interface BuzzSourceRef {
  title: string;
  url: string;
  feed: string;
}

function itemHash(feedName: string, title: string): string {
  return createHash("sha256").update(`${feedName}:${title}`).digest("hex");
}

function trustForFeed(feed: string): number {
  if (PRIMARY_SOURCE_FEED.test(feed)) return 85;
  if (/google-news|yahoo|youtube|buzz/i.test(feed)) return BUZZ_NEWS_TRUST;
  return 50;
}

/** バズ記事の材料ソースを SourceEvent として issueId に紐づけ。既存RSS続報も可能ならリンク */
export async function linkBuzzSourcesToIssue(
  prisma: PrismaClient,
  issueId: string,
  sources: BuzzSourceRef[],
  topicTerm: string | null,
): Promise<{ created: number; linkedExisting: number }> {
  const now = new Date();
  const seenHash = new Set<string>();
  const events = sources
    .filter((s) => s.title.trim() && s.url.trim())
    .map((s) => {
      const feedName = s.feed.trim() || "google-news";
      const hash = itemHash(feedName, s.title.trim());
      if (seenHash.has(hash)) return null;
      seenHash.add(hash);
      return {
        feedName,
        trustWeight: trustForFeed(feedName),
        title: s.title.trim(),
        url: s.url.trim(),
        publishedAt: now,
        hash,
        issueId,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const createResult =
    events.length > 0
      ? await prisma.sourceEvent.createMany({ data: events, skipDuplicates: true })
      : { count: 0 };

  const tokens = extractBuzzMatchTokens(topicTerm ?? "")
    .filter((t) => t.length >= 3 || /氏$|首相|大臣|大統領/.test(t))
    .slice(0, 6);
  let linkedExisting = 0;
  if (tokens.length > 0) {
    const since = new Date(Date.now() - LINK_LOOKBACK_DAYS * 24 * 3600_000);
    const rows = await prisma.sourceEvent.findMany({
      where: {
        issueId: null,
        createdAt: { gte: since },
        OR: tokens.map((term) => ({ title: { contains: term } })),
      },
      orderBy: { createdAt: "desc" },
      take: MAX_MATCHING_RSS,
      select: { id: true },
    });
    if (rows.length > 0) {
      const updated = await prisma.sourceEvent.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { issueId },
      });
      linkedExisting = updated.count;
    }
  }

  return { created: createResult.count, linkedExisting };
}
