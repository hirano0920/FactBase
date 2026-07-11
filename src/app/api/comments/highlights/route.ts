import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, errors, getClientIp } from "@/lib/api-helpers";
import { getDebateHighlights } from "@/lib/data";
import { BURST } from "@/lib/constants";

export const runtime = "nodejs";

/** 賛成派・反対派それぞれの越境評価（bridging）トップコメントを1件ずつ返す（対決表示用） */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const allowed = await checkRateLimit("comments-highlights", ip, BURST.commentsGetPerIpPerMin, 60);
  if (!allowed) return errors.rateLimited();

  const issueId = req.nextUrl.searchParams.get("issueId");
  if (!issueId) return errors.validation("issueIdが必要です");

  try {
    const highlights = await getDebateHighlights(issueId);
    return NextResponse.json(highlights);
  } catch (e) {
    console.error("[comments/highlights] failed", e);
    return errors.internal();
  }
}
