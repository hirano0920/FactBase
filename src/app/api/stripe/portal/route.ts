import { NextResponse, type NextRequest } from "next/server";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Stripeカスタマーポータル（プラン変更・解約・請求履歴）。有料会員のみ。 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const ok = await checkRateLimit("portal", session.user.id, 5, 60);
  if (!ok) return errors.rateLimited();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { stripeCustomerId: true },
  });
  if (!user?.stripeCustomerId) {
    return errors.validation("有料プランのご利用履歴がありません");
  }

  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${req.nextUrl.origin}/pricing`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (e) {
    console.error("[stripe] portal create failed", e);
    return errors.internal();
  }
}
