import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { checkRateLimit, errors, getClientIp } from "@/lib/api-helpers";
import { getSplitComments } from "@/lib/data";
import { BURST, GUEST_COMMENT_LIMIT } from "@/lib/constants";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const allowed = await checkRateLimit("comments-split-get", ip, BURST.commentsGetPerIpPerMin, 60);
  if (!allowed) return errors.rateLimited();

  const issueId = req.nextUrl.searchParams.get("issueId");
  if (!issueId) return errors.validation("issueIdが必要です");
  const forCursor = req.nextUrl.searchParams.get("forCursor") ?? undefined;
  const againstCursor = req.nextUrl.searchParams.get("againstCursor") ?? undefined;

  try {
    // 未ログインはgetComments(GET /api/comments)と同じくGUEST_COMMENT_LIMIT件まで（カラム毎）
    const session = await auth();
    const limit = session?.user ? 20 : GUEST_COMMENT_LIMIT;
    const result = await getSplitComments(issueId, {
      limit,
      forCursor: session?.user ? forCursor : undefined,
      againstCursor: session?.user ? againstCursor : undefined,
    });

    if (!session?.user) {
      return NextResponse.json({
        for: { ...result.for, nextCursor: null, guestLimited: result.for.comments.length >= GUEST_COMMENT_LIMIT },
        against: {
          ...result.against,
          nextCursor: null,
          guestLimited: result.against.comments.length >= GUEST_COMMENT_LIMIT,
        },
      });
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error("[comments/split] list failed", e);
    return errors.internal();
  }
}
