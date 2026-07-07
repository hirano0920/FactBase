import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errors } from "@/lib/api-helpers";
import { getBookmarkedIssues } from "@/lib/data";

export const runtime = "nodejs";

/** サイドバー「保存したスレッド」用。ログイン時のみ。 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return errors.unauthorized();

  const bookmarks = await getBookmarkedIssues(session.user.id, 5);
  return NextResponse.json({ bookmarks });
}
