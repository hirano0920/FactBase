import { CheckCircleIcon, LockIcon, StarIcon } from "lucide-react";
import { auth } from "@/auth";
import { CheckoutButton } from "@/components/pricing/checkout-button";
import { PlusTrialPromo } from "@/components/pricing/plus-trial-promo";
import { ManagePlanButton } from "@/components/pricing/manage-plan-button";
import { PageContainer } from "@/components/layout/page-container";
import { BorderTrail } from "@/components/ui/border-trail";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FC_DAILY_LIMITS, PLAN_PRICES, PLANS, SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** 見出しだけでは伝わりにくい機能に、その場で読める補足を添える */
const FEATURE_TOOLTIPS: { match: string; tooltip: string }[] = [
  {
    match: "沈黙の多数派ヒートマップ",
    tooltip: "投票はせず読むだけの『サイレントマジョリティ』がどちらに傾いているかを可視化します",
  },
  {
    match: "両陣営論点マップ",
    tooltip: "賛成/反対それぞれの主要論点と、相手陣営からも支持を得たコメントの上位を表示します",
  },
  {
    match: "個人影響力・MVP",
    tooltip: "自分の投稿が相手陣営の意見をどれだけ動かしたかをスコア化します",
  },
  {
    match: "レスバ支援 AI",
    tooltip: "反論の組み立てや事実確認をAIが手伝う機能です",
  },
];

function findFeatureTooltip(text: string): string | undefined {
  return FEATURE_TOOLTIPS.find((f) => text.includes(f.match))?.tooltip;
}

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
    <PageContainer>
      <div className="mx-auto max-w-5xl">
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
                "relative flex flex-col overflow-hidden rounded-2xl border",
                premium ? "border-ink bg-ink text-surface shadow-card" : "border-border bg-surface-raised",
              )}
            >
              {highlighted && <BorderTrail size={80} />}

              {plan.dbPlan !== "FREE" && (
                <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-warm px-3 py-1 text-xs font-extrabold text-white shadow-card">
                  3日間無料
                </span>
              )}

              <div
                className={cn(
                  "relative border-b p-6",
                  premium ? "border-surface/10 bg-surface/5" : highlighted ? "border-accent/20 bg-accent-soft/40" : "border-border bg-surface-muted/60",
                )}
              >
                {highlighted && (
                  <span className="absolute right-4 top-4 flex items-center gap-1 rounded-md border border-accent/30 bg-surface-raised px-2 py-0.5 text-[10px] font-bold text-accent">
                    <StarIcon className="h-3 w-3 fill-current" />
                    人気
                  </span>
                )}

                <span className="text-2xl">{plan.icon}</span>
                <h2 className={cn("mt-3 text-lg font-extrabold", premium ? "text-surface" : "text-ink")}>
                  {plan.name}
                </h2>
                <p className={cn("mt-0.5 text-xs font-semibold", premium ? "text-surface/70" : "text-ink-faint")}>
                  {plan.tagline}
                </p>

                <p className="mt-3 flex items-baseline gap-1">
                  <span className={cn("text-3xl font-extrabold tabular-nums", premium ? "text-surface" : "text-ink")}>
                    {typeof plan.price === "number" ? `¥${plan.price}` : plan.price}
                  </span>
                  {typeof plan.price === "number" && (
                    <span className={cn("text-sm font-semibold", premium ? "text-surface/70" : "text-ink-faint")}>
                      /月
                    </span>
                  )}
                </p>
              </div>

              <div className={cn("flex-1 p-6", highlighted && !premium && "bg-accent-soft/10")}>
                <TooltipProvider>
                  <ul className="space-y-2.5 text-sm">
                    {plan.features.map((f) => {
                      const tip = findFeatureTooltip(f);
                      return (
                        <li
                          key={f}
                          className={cn("flex items-start gap-2", premium ? "text-surface/90" : "text-ink-secondary")}
                        >
                          <CheckCircleIcon
                            className={cn("mt-0.5 h-4 w-4 shrink-0", premium ? "text-warm" : "text-for")}
                          />
                          {tip ? (
                            <Tooltip delayDuration={0}>
                              <TooltipTrigger asChild>
                                <span className="cursor-help border-b border-dashed border-current/40">{f}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{tip}</p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span>{f}</span>
                          )}
                        </li>
                      );
                    })}
                    {plan.locked.map((f) => (
                      <li
                        key={f}
                        className={cn("flex items-start gap-2", premium ? "text-surface/40" : "text-ink-faint")}
                      >
                        <LockIcon className="mt-0.5 h-4 w-4 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </TooltipProvider>
              </div>

              <div className={cn("border-t p-4", premium ? "border-surface/10" : "border-border")}>
                {plan.dbPlan === "FREE" && (
                  <p className="mb-3 text-xs text-ink-faint">※無料プランは広告が表示されます</p>
                )}
                {plan.dbPlan === "COMMENT" && (
                  <p className="mb-3 text-xs text-ink-faint">※Plusプランは広告が表示されます</p>
                )}
                {plan.dbPlan !== "FREE" && (
                  <p className="mb-3 text-center text-xs font-bold text-warm-hover">3日間無料体験付き</p>
                )}

                {plan.dbPlan !== "FREE" && (
                  <CheckoutButton
                    plan={plan.dbPlan as "COMMENT" | "FACTCHECK"}
                    isLoggedIn={isLoggedIn}
                    isCurrent={currentPlan === plan.dbPlan}
                  />
                )}
              </div>
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
      </div>
    </PageContainer>
  );
}
