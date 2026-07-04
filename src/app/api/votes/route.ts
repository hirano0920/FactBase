import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { castVote } from "@/lib/votes";
import { invalidateOnVote } from "@/lib/cache-invalidate";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const voteSchema = z.object({
  issueId: z.string().min(1),
  choice: z.enum(["for", "against", "undecided"]),
});

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errors.validation("リクエスト形式が正しくありません");
  }

  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validation("投票内容が正しくありません");
  }

  const userId = session.user.id;
  const ok = await checkRateLimit("vote", userId, 20, 60);
  if (!ok) return errors.rateLimited();

  const issue = await prisma.issue.findUnique({
    where: { id: parsed.data.issueId },
    select: { id: true, status: true, slug: true },
  });
  if (!issue) return errors.notFound("この争点は存在しません");
  if (issue.status === "ARCHIVED") {
    return errors.validation("この争点の投票は終了しています");
  }

  try {
    const tally = await castVote(userId, issue.id, parsed.data.choice);
    void invalidateOnVote(issue.id, issue.slug);
    return NextResponse.json({ tally, userVote: parsed.data.choice });
  } catch (e) {
    console.error("[votes] cast failed", e);
    return errors.internal();
  }
}
