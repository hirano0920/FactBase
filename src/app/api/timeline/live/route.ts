import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, errors, getClientIp } from "@/lib/api-helpers";
import { getGlobalTimeline } from "@/lib/data";
import { BURST } from "@/lib/constants";

export const runtime = "nodejs";
export const revalidate = 30;

/** サイドバー LIVE フィード用。全争点の最新タイムライン */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const allowed = await checkRateLimit("timeline-live", ip, BURST.commentsGetPerIpPerMin, 60);
  if (!allowed) return errors.rateLimited();

  try {
    const entries = await getGlobalTimeline(10);
    return NextResponse.json(
      { entries },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (e) {
    console.error("[timeline/live] failed", e);
    return errors.internal();
  }
}
