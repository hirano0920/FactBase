import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { errors } from "@/lib/api-helpers";
import { getMyParticipatedIssues } from "@/lib/data";

export const runtime = "nodejs";

/** 右カラム「あなたが参加したスレッド」用。ログイン時のみ。 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return errors.unauthorized();

  const issues = await getMyParticipatedIssues(session.user.id, 8);
  return NextResponse.json({ issues });
}
