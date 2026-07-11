import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateRebuttalCards } from "@/lib/ai";
import { extractArgumentSections, formatArgumentSectionsForPrompt } from "@/lib/radar-article";
import {
  errors,
  requireDomesticAccess,
  requireSession,
  checkRateLimit,
} from "@/lib/api-helpers";
import { canUseRebuttalAi } from "@/lib/plan-features";

export const runtime = "nodejs";

const bodySchema = z.object({
  opponentCommentId: z.string().min(1),
});

/** Plus/Pro — 争点素材からレスバ反論候補を生成 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const geo = requireDomesticAccess(req);
  if (geo) return geo;

  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  if (!canUseRebuttalAi(session.user.plan)) {
    return errors.forbidden("レスバ支援 AI は Plus / Pro プランでご利用いただけます");
  }

  const ok = await checkRateLimit("rebuttal-ai", session.user.id, 10, 60 * 60);
  if (!ok) return errors.rateLimited();

  const { slug } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return errors.validation("opponentCommentId が必要です");

  const issue = await prisma.issue.findUnique({
    where: { slug },
    select: {
      id: true,
      title: true,
      summaryJson: true,
      articleHtml: true,
    },
  });
  if (!issue) return errors.notFound("争点が見つかりません");

  const opponent = await prisma.comment.findFirst({
    where: { id: parsed.data.opponentCommentId, issueId: issue.id, isHidden: false },
    select: { body: true, stance: true },
  });
  if (!opponent) return errors.notFound("コメントが見つかりません");

  const myVote = await prisma.vote.findUnique({
    where: { userId_issueId: { userId: session.user.id, issueId: issue.id } },
    select: { choice: true },
  });
  if (!myVote || myVote.choice === "UNDECIDED") {
    return errors.validation("投票してからご利用ください");
  }

  if (opponent.stance === myVote.choice) {
    return errors.validation("同じ立場のコメントには反論候補を生成できません");
  }

  const summary = issue.summaryJson as { lead?: string; bullets?: string[] } | null;
  const myStance = myVote.choice === "FOR" ? "for" : "against";
  const articleDetail = issue.articleHtml
    ? formatArgumentSectionsForPrompt(extractArgumentSections(issue.articleHtml))
    : "";

  try {
    const cards = await generateRebuttalCards({
      issueTitle: issue.title,
      lead: summary?.lead ?? "",
      bullets: summary?.bullets ?? [],
      articleDetail: articleDetail || undefined,
      opponentComment: opponent.body,
      myStance,
    });
    return NextResponse.json({ cards });
  } catch {
    return errors.internal();
  }
}
