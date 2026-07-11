/**
 * Plus向け「議論インテリジェンス」— 両陣営マップ・MVP・両陣営が認めた意見（C-1）。
 */
import { getSplitComments } from "@/lib/data";
import { computeBridgingScore } from "@/lib/bridging";
import { kv } from "@/lib/redis";
import type { SplitComment } from "@/types";

export interface CampTopComment {
  id: string;
  body: string;
  userName: string;
  helpfulCount: number;
  crossHelpful: number;
  bridgingScore: number;
}

export interface IssueDebateIntel {
  campMap: { for: CampTopComment | null; against: CampTopComment | null };
  mvp: (CampTopComment & { stance: "for" | "against" }) | null;
  acknowledged: { for: CampTopComment | null; against: CampTopComment | null };
}

const CACHE_TTL_SEC = 60;

function toCampTop(c: SplitComment): CampTopComment {
  return {
    id: c.id,
    body: c.body,
    userName: c.userName,
    helpfulCount: c.helpfulCount,
    crossHelpful: c.crossHelpful,
    bridgingScore: computeBridgingScore(c.helpfulCount, c.crossHelpful),
  };
}

function topHumanComment(comments: SplitComment[]): CampTopComment | null {
  const human = comments.find((c) => !c.isAiSteelman && c.helpfulCount > 0);
  return human ? toCampTop(human) : null;
}

/** 争点の両陣営マップ・MVP・acknowledged facts を返す */
export async function getIssueDebateIntel(issueId: string): Promise<IssueDebateIntel> {
  const cacheKey = `cache:debate-intel:${issueId}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as IssueDebateIntel;
  } catch {
    // fall through
  }

  const split = await getSplitComments(issueId, { limit: 10 });

  const campFor = topHumanComment(split.for.comments);
  const campAgainst = topHumanComment(split.against.comments);

  const mvpCandidates: (CampTopComment & { stance: "for" | "against" })[] = [];
  if (campFor) mvpCandidates.push({ ...campFor, stance: "for" });
  if (campAgainst) mvpCandidates.push({ ...campAgainst, stance: "against" });

  const mvp =
    mvpCandidates.sort((a, b) => b.bridgingScore - a.bridgingScore)[0] ?? null;

  const result: IssueDebateIntel = {
    campMap: { for: campFor, against: campAgainst },
    mvp,
    acknowledged: { for: campFor, against: campAgainst },
  };

  try {
    await kv.set(cacheKey, JSON.stringify(result), { ex: CACHE_TTL_SEC });
  } catch {
    // ignore
  }

  return result;
}
