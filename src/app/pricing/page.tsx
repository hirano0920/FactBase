import { auth } from "@/auth";
import { PageContainer } from "@/components/layout/page-container";
import { CheckoutButton } from "@/components/pricing/checkout-button";
import { ManagePlanButton } from "@/components/pricing/manage-plan-button";
import { PLAN_PRICES, PLANS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Plus/Proプラン",
};

const PLANS_DISPLAY = [
  {
    id: PLANS.FREE,
    dbPlan: "FREE",
    name: "無料",
    icon: "🆓",
    price: "¥0",
    tagline: "まずはここから",
    features: ["争点・記事の閲覧", "投票・共感"],
    locked: ["コメント投稿", "ワンタップFC", "広告なし"],
  },
  {
    id: PLANS.COMMENT,
    dbPlan: "COMMENT",
    name: "FactBase Plus",
    icon: "💬",
    price: PLAN_PRICES[PLANS.COMMENT],
    tagline: "議論に参加する",
    features: ["無料のすべて", "コメント投稿", "広告なし"],
    locked: ["ワンタップFC"],
    highlighted: true,
  },
  {
    id: PLANS.FACTCHECK,
    dbPlan: "FACTCHECK",
    name: "FactBase Pro",
    icon: "👑",
    price: PLAN_PRICES[PLANS.FACTCHECK],
    tagline: "本気で見極める",
    features: ["Plusのすべて", "ワンタップファクトチェック", "広告なし"],
    locked: [],
    premium: true,
    footnote: "※ワンタップファクトチェックは1日30回まで",
  },
] as const;

interface PricingPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const [session, { status }] = await Promise.all([auth(), searchParams]);
  const currentPlan = session?.user?.plan ?? null;
  const isLoggedIn = Boolean(session?.user);

  return (
    <PageContainer width="content">
      <header className="mb-10 text-center">
        <p className="mb-2 text-xs font-extrabold tracking-widest text-warm">✨ FACTBASE PLUS/PRO</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          もっと深く、もっと自由に。
        </h1>
        <p className="mx-auto mt-3 max-w-md text-ink-muted">
          閲覧と投票は無料。有料プランは3日間無料で試せます。
        </p>
      </header>

      {status === "success" && (
        <p className="mb-8 rounded-md border border-for/30 bg-for-muted px-4 py-3 text-center text-sm text-for">
          ご登録ありがとうございます。プランの反映まで数十秒かかることがあります。
        </p>
      )}
      {status === "cancelled" && (
        <p className="mb-8 rounded-md border border-border bg-surface-muted px-4 py-3 text-center text-sm text-ink-secondary">
          手続きはキャンセルされました。いつでも再開できます。
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        {PLANS_DISPLAY.map((plan) => {
          const premium = "premium" in plan && plan.premium;
          const highlighted = "highlighted" in plan && plan.highlighted;

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-2xl border p-6",
                premium
                  ? "border-ink bg-ink text-surface shadow-card"
                  : highlighted
                    ? "border-accent/40 bg-surface-raised ring-1 ring-accent/15"
                    : "border-border bg-surface-raised",
              )}
            >
              {premium && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-warm px-3 py-1 text-xs font-extrabold text-white shadow-card">
                  👑 おすすめ
                </span>
              )}

              <span className="text-2xl">{plan.icon}</span>
              <h2 className={cn("mt-3 text-lg font-extrabold", premium ? "text-surface" : "text-ink")}>
                {plan.name}
              </h2>
              <p className={cn("mt-0.5 text-xs font-semibold", premium ? "text-surface/70" : "text-ink-faint")}>
                {plan.tagline}
              </p>

              <p className="mt-4 flex items-baseline gap-1">
                <span className={cn("text-3xl font-extrabold tabular-nums", premium ? "text-surface" : "text-ink")}>
                  {typeof plan.price === "number" ? `¥${plan.price}` : plan.price}
                </span>
                {typeof plan.price === "number" && (
                  <span className={cn("text-sm font-semibold", premium ? "text-surface/70" : "text-ink-faint")}>
                    /月
                  </span>
                )}
              </p>

              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className={cn("flex items-start gap-2", premium ? "text-surface/90" : "text-ink-secondary")}>
                    <span className={premium ? "text-warm" : "text-for"}>✓</span>
                    {f}
                  </li>
                ))}
                {plan.locked.map((f) => (
                  <li key={f} className={cn("flex items-start gap-2", premium ? "text-surface/40" : "text-ink-faint")}>
                    <span>🔒</span>
                    {f}
                  </li>
                ))}
              </ul>

              {plan.dbPlan !== "FREE" && (
                <div className="mt-6">
                  <CheckoutButton
                    plan={plan.dbPlan as "COMMENT" | "FACTCHECK"}
                    isLoggedIn={isLoggedIn}
                    isCurrent={currentPlan === plan.dbPlan}
                  />
                </div>
              )}

              {"footnote" in plan && plan.footnote && (
                <p className={cn("mt-3 text-[11px]", premium ? "text-surface/50" : "text-ink-faint")}>
                  {plan.footnote}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {currentPlan && currentPlan !== "FREE" && (
        <div className="mt-8">
          <ManagePlanButton />
        </div>
      )}

      <p className="mt-8 text-center text-xs text-ink-faint">
        決済はWeb（Stripe）のみ。無料体験後に月額課金が開始されます。1人1票。票の重み付けはありません。
      </p>
    </PageContainer>
  );
}
