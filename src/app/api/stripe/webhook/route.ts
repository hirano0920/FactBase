import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, planForPriceId } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { kv } from "@/lib/redis";

export const runtime = "nodejs";

/** metadataのuserIdを優先し、無ければstripeCustomerIdからユーザーを解決 */
async function resolveUserId(
  metadataUserId: string | undefined,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  const customerId = typeof customer === "string" ? customer : customer?.id;
  if (!customerId) return null;
  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * Stripe webhook。署名検証必須・イベントIDで冪等化。
 * checkout.session.completed → plan付与
 * customer.subscription.updated/deleted → plan同期/FREE化
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const payload = await req.text();
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (e) {
    console.error("[stripe] signature verification failed", e);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // 冪等化: 同一イベントの再送は無視（Stripeは最大3日再送する）
  const idempotencyKey = `stripe:event:${event.id}`;
  const seen = await kv.get(idempotencyKey);
  if (seen) return NextResponse.json({ received: true, duplicate: true });
  await kv.set(idempotencyKey, "1", { ex: 60 * 60 * 24 * 4 });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.client_reference_id ?? session.metadata?.userId;
        const plan = session.metadata?.plan;

        // 3日間の無料体験では初回決済が発生しないため no_payment_required も許可する
        if (
          session.payment_status !== "paid" &&
          session.payment_status !== "no_payment_required"
        ) {
          console.warn("[stripe] checkout completed without payment", session.id);
          break;
        }
        if (userId && (plan === "COMMENT" || plan === "FACTCHECK")) {
          await prisma.user.update({
            where: { id: userId },
            data: {
              plan,
              planUntil: null,
              // customer/subscriptionを記録（解約導線・以降のwebhook解決に使用）
              stripeCustomerId:
                typeof session.customer === "string" ? session.customer : undefined,
              stripeSubscriptionId:
                typeof session.subscription === "string" ? session.subscription : undefined,
            },
          });
        } else {
          console.error("[stripe] checkout completed without userId/plan", session.id);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const userId = await resolveUserId(sub.metadata?.userId, sub.customer);
        if (!userId) break;

        if (sub.status === "active" || sub.status === "trialing") {
          const priceId = sub.items.data[0]?.price?.id;
          const plan = priceId ? planForPriceId(priceId) : null;
          if (plan) {
            await prisma.user.update({
              where: { id: userId },
              data: { plan, planUntil: null, stripeSubscriptionId: sub.id },
            });
          }
        } else if (
          sub.status === "canceled" ||
          sub.status === "unpaid" ||
          sub.status === "incomplete_expired"
        ) {
          await prisma.user.update({
            where: { id: userId },
            data: { plan: "FREE", planUntil: null, stripeSubscriptionId: null },
          });
        } else if (sub.status === "past_due") {
          // 支払い失敗直後の猶予期間（StripeのSmart Retriesで数日リトライされる）。
          // プランはすぐ剥奪せず、planUntilに猶予終了予定日を記録するだけに留める。
          // リトライが尽きると status は unpaid に遷移し、上のブランチでFREEに落ちる。
          const periodEnd = sub.items.data[0]?.current_period_end;
          await prisma.user.update({
            where: { id: userId },
            data: { planUntil: periodEnd ? new Date(periodEnd * 1000) : null },
          });
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const userId = await resolveUserId(sub.metadata?.userId, sub.customer);
        if (userId) {
          await prisma.user.update({
            where: { id: userId },
            data: { plan: "FREE", planUntil: null, stripeSubscriptionId: null },
          });
        }
        break;
      }

      default:
        break;
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    // 処理失敗はStripeに再送させる（500返却）。冪等キーは消して再処理可能に
    console.error(`[stripe] handler failed for ${event.type}`, e);
    await kv.set(idempotencyKey, "", { ex: 1 });
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
