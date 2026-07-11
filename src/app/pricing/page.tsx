import { auth } from "@/auth";
import { CheckoutButton } from "@/components/pricing/checkout-button";
import { PlusTrialPromo } from "@/components/pricing/plus-trial-promo";
import { ManagePlanButton } from "@/components/pricing/manage-plan-button";
import { PageContainer } from "@/components/layout/page-container";
import { FC_DAILY_LIMITS, PLAN_PRICES, PLANS, SITE } from "@/lib/constants";
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
    tagline: "第3のメディアを体験",
    features: [
      "争点記事・投票・スプリット議論",
      "ログインでコメント投稿",
      "層の動きの概要（n・変化率）",
    ],
    locked: ["両陣営マップ詳細", "レスバ支援 AI", "広告非表示"],
  },
  {
    id: PLANS.COMMENT,
    dbPlan: "COMMENT",
    name: `${SITE.name} Plus`,
    icon: "💬",
    price: PLAN_PRICES[PLANS.COMMENT],
    tagline: "世論の計器",
    features: [
      "無料のすべて",
      "読前→読後の層の動き（詳細）",
      "沈黙の多数派ヒートマップ",
      "両陣営論点マップ・越境トップ",
      "個人影響力・MVP表示",
      `レスバ支援 AI · 出典チェック（1日${FC_DAILY_LIMITS.COMMENT}回）`,
    ],
    locked: ["広告非表示"],
    highlighted: true,
  },
  {
    id: PLANS.FACTCHECK,
    dbPlan: "FACTCHECK",
    name: `${SITE.name} Pro`,
    icon: "👑",
    price: PLAN_PRICES[PLANS.FACTCHECK],
    tagline: "本気で議論する",
    features: [
      "Plus のすべて",
      "広告非表示",
      `出典チェック 1日${FC_DAILY_LIMITS.FACTCHECK}回`,
      "レスバ支援 AI 多め",
    ],
    locked: [],
    premium: true,
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
        <p className="mb-2 text-xs font-extrabold tracking-widest text-warm">
          ✨ {SITE.name.toUpperCase()} PLUS/PRO
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          議論は無料。計器は Plus / Pro。
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-ink-muted">
          投票・スプリット・コメントはログインすれば無料。
          <strong className="text-ink"> 層の動き・両陣営マップ・影響力</strong>
          は Grok にない TwoSides 独自のデータ（3日間無料体験あり）。
        </p>
      </header>

      <PlusTrialPromo className="mb-8" />

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
              {plan.dbPlan !== "FREE" && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-warm px-3 py-1 text-xs font-extrabold text-white shadow-card">
                  3日間無料
                </span>
              )}
              {premium && (
                <span className="absolute -top-3 right-4 rounded-full border border-warm/30 bg-surface-raised px-2 py-0.5 text-[10px] font-bold text-warm-hover">
                  おすすめ
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

              {plan.dbPlan === "FREE" && (
                <p className="mt-4 text-xs text-ink-faint">※無料プランは広告が表示されます</p>
              )}
              {plan.dbPlan === "COMMENT" && (
                <p className="mt-4 text-xs text-ink-faint">※Plusプランは広告が表示されます</p>
              )}

              {plan.dbPlan !== "FREE" && (
                <p className="mt-4 text-center text-xs font-bold text-warm-hover">3日間無料体験付き</p>
              )}

              {plan.dbPlan !== "FREE" && (
                <div className="mt-6">
                  <CheckoutButton
                    plan={plan.dbPlan as "COMMENT" | "FACTCHECK"}
                    isLoggedIn={isLoggedIn}
                    isCurrent={currentPlan === plan.dbPlan}
                  />
                </div>
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
