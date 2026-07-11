import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { bucketIntensity, clampIntensity } from "@/lib/spectrum";

export const runtime = "nodejs";

const spectrumSchema = z.object({
  intensity: z.number(),
});

/**
 * 読了後の連続スライダー投票（-100〜+100）。「沈黙の多数派」ヒートマップ（A-4）の元データになる。
 * 「読了後にだけ表示」の設計原則を守るため、まず通常投票（BEFORE_READ・Vote）が
 * 済んでいることを要求する（=争点ページの投票ゲートを経由済みであることの担保）。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errors.validation("リクエスト形式が正しくありません");
  }
  const parsed = spectrumSchema.safeParse(body);
  if (!parsed.success) return errors.validation("intensityは数値で指定してください");

  const ok = await checkRateLimit("spectrum-vote", session.user.id, 20, 60);
  if (!ok) return errors.rateLimited();

  const { slug } = await params;
  const issue = await prisma.issue.findUnique({ where: { slug }, select: { id: true } });
  if (!issue) return errors.notFound("争点が見つかりません");

  const existingVote = await prisma.vote.findUnique({
    where: { userId_issueId: { userId: session.user.id, issueId: issue.id } },
    select: { id: true },
  });
  if (!existingVote) {
    return errors.forbidden("先に投票してから、両論を読んだ上でもう一度お答えください");
  }

  const intensity = clampIntensity(parsed.data.intensity);
  const choice = bucketIntensity(intensity);

  await prisma.voteEvent.upsert({
    where: { userId_issueId_phase: { userId: session.user.id, issueId: issue.id, phase: "AFTER_READ" } },
    create: { userId: session.user.id, issueId: issue.id, phase: "AFTER_READ", choice, intensity },
    update: { choice, intensity },
  });

  return NextResponse.json({ intensity, choice: choice.toLowerCase() });
}
