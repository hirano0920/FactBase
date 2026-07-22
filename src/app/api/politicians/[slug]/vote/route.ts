import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, checkRateLimit, getClientIp, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import {
  castPoliticianVote,
  getPoliticianSupportStats,
  getMyPoliticianVote,
} from "@/lib/politician-votes";
import { auth } from "@/auth";
import { BURST } from "@/lib/constants";

export const runtime = "nodejs";

const voteSchema = z.object({
  choice: z.enum(["for", "against", "undecided"]),
});

/** 現在の集計＋（ログイン時）自分の投票。政治家ページのハイドレーション用 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const ip = getClientIp(req);
  const allowed = await checkRateLimit("api-ip", ip, BURST.apiPerIpPerMin, 60);
  if (!allowed) return errors.rateLimited();

  const { slug } = await params;
  const politician = await prisma.politician.findUnique({
    where: { slug: decodeURIComponent(slug) },
    select: { id: true },
  });
  if (!politician) return errors.notFound("この政治家は登録されていません");

  const session = await auth();
  const [stats, myVote] = await Promise.all([
    getPoliticianSupportStats(politician.id),
    session?.user?.id ? getMyPoliticianVote(session.user.id, politician.id) : Promise.resolve(null),
  ]);
  return NextResponse.json({ stats, myVote });
}

/** 評価投票（ログイン必須・1人1票・変更可）。争点投票と同じセッションゲート */
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
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) return errors.validation("投票内容が正しくありません");

  const userId = session.user.id;
  const ok = await checkRateLimit("politician-vote", userId, 20, 60);
  if (!ok) return errors.rateLimited();

  const { slug } = await params;
  const politician = await prisma.politician.findUnique({
    where: { slug: decodeURIComponent(slug) },
    select: { id: true },
  });
  if (!politician) return errors.notFound("この政治家は登録されていません");

  try {
    const stats = await castPoliticianVote(userId, politician.id, parsed.data.choice);
    return NextResponse.json({ stats, myVote: parsed.data.choice });
  } catch (e) {
    console.error("[politician-vote] cast failed", e);
    return errors.internal();
  }
}
