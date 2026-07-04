import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { errors } from "@/lib/api-helpers";
import { isBookmarked, isDbEnabled } from "@/lib/data";
import { getUserVote } from "@/lib/votes";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ログイン済みユーザーの争点ページ用パーソナライズデータ（静的シェルからクライアント取得） */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const issue = await prisma.issue.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!issue) return errors.notFound("この争点は存在しません");

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ isLoggedIn: false as const });
  }

  const [userVote, bookmarked] = await Promise.all([
    isDbEnabled() ? getUserVote(session.user.id, issue.id) : Promise.resolve(null),
    isDbEnabled() ? isBookmarked(session.user.id, issue.id) : Promise.resolve(false),
  ]);

  return NextResponse.json({
    isLoggedIn: true as const,
    plan: session.user.plan,
    userVote,
    bookmarked,
  });
}
