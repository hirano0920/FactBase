import { NextResponse, type NextRequest } from "next/server";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** 「保存したスレッド」トグル。POST=保存、DELETE=解除。冪等。 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const ok = await checkRateLimit("bookmark", session.user.id, 60, 60);
  if (!ok) return errors.rateLimited();

  const { slug } = await params;
  const issue = await prisma.issue.findUnique({ where: { slug }, select: { id: true } });
  if (!issue) return errors.notFound("争点が見つかりません");

  await prisma.bookmark.upsert({
    where: { userId_issueId: { userId: session.user.id, issueId: issue.id } },
    create: { userId: session.user.id, issueId: issue.id },
    update: {},
  });

  return NextResponse.json({ bookmarked: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { slug } = await params;
  const issue = await prisma.issue.findUnique({ where: { slug }, select: { id: true } });
  if (!issue) return errors.notFound("争点が見つかりません");

  await prisma.bookmark.deleteMany({
    where: { userId: session.user.id, issueId: issue.id },
  });

  return NextResponse.json({ bookmarked: false });
}
