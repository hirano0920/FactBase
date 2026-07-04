import { BURST } from "@/lib/constants";
import { issueSlugKey, kv } from "@/lib/redis";
import type { Issue } from "@/types";

export async function getCachedIssue(slug: string): Promise<Issue | null> {
  try {
    const raw = await kv.get(issueSlugKey(slug));
    if (!raw) return null;
    return JSON.parse(raw) as Issue;
  } catch {
    return null;
  }
}

export async function setCachedIssue(slug: string, issue: Issue): Promise<void> {
  try {
    await kv.set(issueSlugKey(slug), JSON.stringify(issue), { ex: BURST.issueCacheSec });
  } catch {
    // cache miss on next request
  }
}

export async function invalidateCachedIssue(slug: string): Promise<void> {
  try {
    await kv.del(issueSlugKey(slug));
  } catch {
    // ignore
  }
}
