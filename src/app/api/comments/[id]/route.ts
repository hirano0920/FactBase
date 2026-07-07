import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, errors, getClientIp } from "@/lib/api-helpers";
import { getCommentById } from "@/lib/data";
import { BURST } from "@/lib/constants";

export const runtime = "nodejs";

/** 返信投稿直後にそのスレッド（親コメント＋返信一覧）だけを最新化するための単発取得 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ip = getClientIp(req);
  const allowed = await checkRateLimit("comments-get", ip, BURST.commentsGetPerIpPerMin, 60);
  if (!allowed) return errors.rateLimited();

  const { id } = await params;
  try {
    const comment = await getCommentById(id);
    if (!comment) return errors.notFound("コメントが見つかりません");
    return NextResponse.json(comment);
  } catch (e) {
    console.error("[comments/:id] failed", e);
    return errors.internal();
  }
}
