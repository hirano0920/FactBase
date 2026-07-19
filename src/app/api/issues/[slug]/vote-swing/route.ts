import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getVoteSwing } from "@/lib/vote-swing";
import { checkRateLimit, getClientIp } from "@/lib/api-helpers";
import { BURST } from "@/lib/constants";

export const runtime = "nodejs";

/** 中立層スイング可視化: 直近3時間で賛否がどう動いたか。母数が少なければswing=nullを返す */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const ip = getClientIp(req);
  const allowed = await checkRateLimit("api-ip", ip, BURST.apiPerIpPerMin, 60);
  if (!allowed) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }

  const { slug } = await params;
  const issue = await prisma.issue.findUnique({ where: { slug }, select: { id: true } });
  if (!issue) return NextResponse.json({ error: "争点が見つかりません" }, { status: 404 });

  const swing = await getVoteSwing(issue.id);
  return NextResponse.json({ swing });
}
