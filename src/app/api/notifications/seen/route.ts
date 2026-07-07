import { NextResponse, type NextRequest } from "next/server";
import { requireSession, errors } from "@/lib/api-helpers";
import { markNotificationsSeen } from "@/lib/notifications";
import { isDbEnabled } from "@/lib/data";

export const runtime = "nodejs";

/** 通知ドロップダウンを開いた時に呼び、既読カーソルを進める */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  try {
    if (isDbEnabled()) await markNotificationsSeen(session.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[notifications/seen] failed", e);
    return errors.internal();
  }
}
