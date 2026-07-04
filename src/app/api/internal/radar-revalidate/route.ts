import { NextResponse, type NextRequest } from "next/server";
import { revalidateAfterIssueUpdate } from "@/lib/revalidate-pages";
import { invalidateCachedIssue } from "@/lib/issue-cache";
import { bumpTimelineCache } from "@/lib/cache-invalidate";

export const runtime = "nodejs";

/**
 * Radarパイプライン（scripts/radar/*.ts、GitHub Actions上のtsx単体プロセス）専用の内部エンドポイント。
 * revalidatePath はRoute Handler/Server Actionからしか呼べないため、cronスクリプトはここをHTTP経由で叩く。
 * 失敗しても呼び出し側はベストエフォート扱い（1時間ISRがフォールバック）。
 */
export async function POST(req: NextRequest) {
  const secret = process.env.RADAR_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "RADAR_INTERNAL_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : undefined;
  const issueId = typeof body?.issueId === "string" ? body.issueId : undefined;
  if (!slug || !issueId) {
    return NextResponse.json({ error: "slug and issueId are required" }, { status: 400 });
  }

  await Promise.all([invalidateCachedIssue(slug), bumpTimelineCache(issueId)]);
  revalidateAfterIssueUpdate(slug);

  return NextResponse.json({ ok: true });
}
