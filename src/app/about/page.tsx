import Image from "next/image";
import Link from "next/link";
import { AboutDifferentiatorCard } from "@/components/about/about-differentiator-card";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer } from "@/components/layout/page-container";
import { MAIN_SIDEBAR_GRID, SITE } from "@/lib/constants";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `${SITE.name}を知る`,
  description:
    `${SITE.name}の目的、他SNS・メディアとの違い、Radar、議論インテリジェンス。第3のメディアとしての中立な討論会場。`,
};

const DIFFERENTIATORS = [
  {
    title: "おすすめアルゴリズムがない",
    description: "鬱になるタイムラインはありません。争点・新着・投票結果だけ。",
  },
  {
    title: "両側が見えるスプリット",
    description: "FOR / AGAINST を意図的に並べ、自分と違う意見も読めます。越境評価で健全なランキング。",
  },
  {
    title: "議論インテリジェンス（Plus）",
    description: "読前→読後の層の動き、両陣営マップ、影響力 — Grok にない TwoSides 独自データ。",
  },
  {
    title: "運営情報を公開",
    description: "使用AI・データソース・モデレーション基準を透明性ページで公開しています。",
  },
] as const;

export default function AboutPage() {
  return (
    <PageContainer>
      <div className={`grid gap-8 ${MAIN_SIDEBAR_GRID}`}>
        <div className="min-w-0 max-w-content space-y-12">
          <ScrollReveal>
            <header className="space-y-4">
              <p className="text-xs font-bold tracking-widest text-accent">ABOUT · 第3のメディア</p>
              <h1 className="text-3xl font-extrabold tracking-tight text-ink">
                偏向報道でも、SNSのフィルターバブルでもない。
              </h1>
              <p className="text-base leading-relaxed text-ink-secondary">
                <strong className="font-semibold text-ink">中立な討論会場</strong>
                — 争点を整理し、投票し、両側の議論が見える場所です。
                オールドメディアの偏向と、X・ヤフコメ・YouTubeの同調圏のあいだにあります。
              </p>
              <p className="text-sm leading-relaxed text-ink-muted">
                記事は <strong className="font-medium text-ink-secondary">{SITE.name} Radar</strong>
                がバズ争点から自動生成。議論の質は越境評価と出典チェック（Plus/Pro）で支えます。
              </p>
            </header>
          </ScrollReveal>

          <ScrollReveal delay={60}>
            <section>
              <h2 className="mb-4 text-lg font-bold text-ink">他のメディア・SNSとの違い</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {DIFFERENTIATORS.map((item, i) => (
                  <AboutDifferentiatorCard
                    key={item.title}
                    index={i}
                    title={item.title}
                    description={item.description}
                  />
                ))}
              </div>
            </section>
          </ScrollReveal>

          <ScrollReveal delay={60}>
            <section>
              <h2 className="mb-6 text-lg font-bold text-ink">立ち上げ人</h2>
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                <div className="shrink-0">
                  <Image
                    src="/images/creator.png"
                    alt="平野大介"
                    width={120}
                    height={120}
                    className="rounded-xl border border-border object-cover object-top"
                    priority
                  />
                </div>
                <div className="min-w-0 space-y-4 text-sm leading-relaxed text-ink-secondary">
                  <div>
                    <p className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">平野 大介</p>
                    <p className="mt-2 text-sm font-bold tracking-widest text-accent">立ち上げ人</p>
                    <p className="mt-1 font-semibold text-ink-secondary">
                      東京都町田市出身 · 現役慶應義塾大学1年生
                    </p>
                  </div>
                  <p>
                    SNSのフィルターバブルと偏向報道に疲れた人向けに、
                    中立で両論が見える討論場 {SITE.displayName} を立ち上げました。
                  </p>
                  <p className="text-xs text-ink-faint">
                    特定の政党・思想を支持するサービスではありません。判断基準は争点素材とコミュニティの越境評価です。
                  </p>
                </div>
              </div>
            </section>
          </ScrollReveal>

          <ScrollReveal delay={60}>
            <section className="border-t border-border pt-8 text-sm text-ink-muted">
              <p>
                使用AI・インフラ・モデレーションの詳細は{" "}
                <Link href="/transparency" className="font-semibold text-link">
                  透明性ページ
                </Link>
                をご覧ください。
              </p>
            </section>
          </ScrollReveal>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
