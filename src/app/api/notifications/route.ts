import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errors } from "@/lib/api-helpers";
import { getFollowedUpdates } from "@/lib/notifications";
import { isDbEnabled } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ブックマーク/投票した争点の続報通知（ヘッダーのベルアイコン用） */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ isLoggedIn: false as const, items: [] });

  try {
    const { items } = isDbEnabled()
      ? await getFollowedUpdates(session.user.id)
      : { items: [] };
    return NextResponse.json({ isLoggedIn: true as const, items });
  } catch (e) {
    console.error("[notifications] failed", e);
    return errors.internal();
  }
}
