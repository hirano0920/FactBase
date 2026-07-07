import Stripe from "stripe";
import type { Plan } from "@prisma/client";

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

export function getStripe(): Stripe {
  if (!globalForStripe.stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    globalForStripe.stripe = new Stripe(key, {
      // デフォルトのNode httpエージェント（持続的TCP接続）はCloudflare Workersで
      // ハングする。Workersがネイティブにサポートするfetchベースに切り替える。
      httpClient: Stripe.createFetchHttpClient(),
    });
  }
  return globalForStripe.stripe;
}

export type PaidPlan = Exclude<Plan, "FREE">;

export function priceIdFor(plan: PaidPlan): string {
  const id =
    plan === "COMMENT"
      ? process.env.STRIPE_PRICE_COMMENT
      : process.env.STRIPE_PRICE_FACTCHECK;
  if (!id) throw new Error(`Stripe price id for ${plan} is not set`);
  return id;
}

export function planForPriceId(priceId: string): PaidPlan | null {
  if (priceId === process.env.STRIPE_PRICE_COMMENT) return "COMMENT";
  if (priceId === process.env.STRIPE_PRICE_FACTCHECK) return "FACTCHECK";
  return null;
}
