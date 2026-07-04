import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { getStripe, priceIdFor } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const checkoutSchema = z.object({
  plan: z.enum(["COMMENT", "FACTCHECK"]),
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

  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return errors.validation("プランの指定が正しくありません");

  const ok = await checkRateLimit("checkout", session.user.id, 5, 60);
  if (!ok) return errors.rateLimited();

  // 二重課金防止: 既に有料プランならcheckoutさせず、プラン変更・解約はポータルへ誘導
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true, stripeCustomerId: true, email: true },
  });
  if (!user) return errors.unauthorized();
  if (user.plan !== "FREE") {
    return errors.validation(
      "既に有料プランをご利用中です。プラン変更・解約は「プラン管理」から行えます",
    );
  }

  const origin = req.nextUrl.origin;

  try {
    // 既存customerがあれば再利用（同一ユーザーに複数customerを作らない）
    const checkout = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceIdFor(parsed.data.plan), quantity: 1 }],
      // userIdをclient_reference_idで渡し、webhookでplan反映に使う
      client_reference_id: session.user.id,
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email ?? undefined }),
      success_url: `${origin}/pricing?status=success`,
      cancel_url: `${origin}/pricing?status=cancelled`,
      metadata: { userId: session.user.id, plan: parsed.data.plan },
      subscription_data: {
        trial_period_days: 3,
        metadata: { userId: session.user.id, plan: parsed.data.plan },
      },
    });

    if (!checkout.url) return errors.internal();
    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    console.error("[stripe] checkout create failed", e);
    return errors.internal();
  }
}
