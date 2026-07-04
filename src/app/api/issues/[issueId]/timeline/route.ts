import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, errors, getClientIp } from "@/lib/api-helpers";
import { getIssueTimeline } from "@/lib/data";
import { BURST } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 争点ページ LIVE タイムライン用 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ issueId: string }> },
) {
  const ip = getClientIp(req);
  const allowed = await checkRateLimit("timeline-issue", ip, BURST.commentsGetPerIpPerMin, 60);
  if (!allowed) return errors.rateLimited();

  const { issueId } = await params;
  if (!issueId) return errors.validation("issueIdが必要です");

  try {
    const entries = await getIssueTimeline(issueId, 15);
    return NextResponse.json({ entries });
  } catch (e) {
    console.error("[timeline/issue] failed", e);
    return errors.internal();
  }
}
