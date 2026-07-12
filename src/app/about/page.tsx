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

const ENEMIES = [
  {
    tag: "オールドメディア型",
    title: "偏向報道",
    description: "1社の切り取り方だけを読まされ、他の見方があることに気づけない。",
    tone: "warm",
  },
  {
    tag: "SNS型",
    title: "フィルターバブル",
    description: "おすすめアルゴリズムが同意見ばかり並べ、声の大きい極端な意見が勝つ。",
    tone: "accent",
  },
] as const;

const COUNTERS = [
  {
    num: 1,
    title: "複数媒体を横断参照",
    description: "1つの争点につき複数の報道・一次情報を突き合わせてから要約するので、1社の偏向に引っ張られません。",
    against: "対・偏向報道",
    tone: "warm",
  },
  {
    num: 2,
    title: "スプリットスレッド",
    description: "画面を最初からFOR/AGAINSTに分けて表示。相手陣営からも支持された意見（越境評価）が上に来る仕組みで、声の大きい極端な意見だけが目立つ状態を防ぎます。",
    against: "対・フィルターバブル",
    tone: "accent",
  },
  {
    num: 3,
    title: "複数AIモデルで品質チェック",
    description: "記事を書くAIと、出典と照合して採点するAIを分離（Grok 4.3で生成→ChatGPT 5 nanoが独立照合）。書いた本人に採点させないので、AI自身の偏りも防ぎます。",
    against: "対・偏向報道",
    tone: "warm",
  },
  {
    num: 4,
    title: "おすすめアルゴリズムなし",
    description: "あなたの好みに最適化されたタイムラインは存在しません。争点・新着・投票結果だけが並びます。",
    against: "対・フィルターバブル",
    tone: "accent",
  },
] as const;

const SECONDARY_FEATURES = [
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
            <header className="rounded-[20px] border border-border bg-surface-raised px-6 py-10 text-center sm:px-10">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-extrabold tracking-wide text-accent">
                🎯 究極の命題
              </span>
              <h1 className="mx-auto mt-4 max-w-[18ch] text-2xl font-extrabold leading-snug tracking-tight text-ink sm:text-3xl">
                まともな
                <span className="bg-gradient-to-r from-accent to-hot bg-clip-text text-transparent">議論</span>
                ができる環境を、日本のネットに作る。
              </h1>
              <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-secondary">
                オールドメディアの偏向と、SNSのフィルターバブル。この2つに挟まれた人が、
                声の大きさでなく納得感で意見を磨ける場所を目指しています。
              </p>
            </header>
          </ScrollReveal>

          <ScrollReveal delay={60}>
            <section>
              <div className="mb-4 flex items-center gap-2">
                <h2 className="text-sm font-extrabold tracking-wide text-ink-faint">
                  {SITE.name}が対抗している2つの敵
                </h2>
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {ENEMIES.map((enemy) => (
                  <div
                    key={enemy.title}
                    className={
                      enemy.tone === "warm"
                        ? "rounded-2xl border border-warm/35 bg-gradient-to-br from-warm-muted to-surface-raised p-5"
                        : "rounded-2xl border border-accent/30 bg-gradient-to-br from-accent-soft to-surface-raised p-5"
                    }
                  >
                    <span
                      className={
                        enemy.tone === "warm"
                          ? "inline-block rounded-full bg-warm/15 px-2.5 py-1 text-[10.5px] font-extrabold tracking-wide text-warm"
                          : "inline-block rounded-full bg-accent/10 px-2.5 py-1 text-[10.5px] font-extrabold tracking-wide text-accent"
                      }
                    >
                      {enemy.tag}
                    </span>
                    <p className="mt-2.5 text-base font-extrabold text-ink">{enemy.title}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{enemy.description}</p>
                  </div>
                ))}
              </div>

              <p className="my-4 text-center text-xs font-bold tracking-wide text-ink-faint">
                ↓ {SITE.name}の対抗策 ↓
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                {COUNTERS.map((counter) => (
                  <div key={counter.title} className="rounded-2xl border border-border bg-surface-raised p-5">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[10.5px] font-extrabold text-white">
                      {counter.num}
                    </span>
                    <p className="mt-2.5 text-sm font-extrabold text-ink">{counter.title}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{counter.description}</p>
                    <span
                      className={
                        counter.tone === "warm"
                          ? "mt-2.5 inline-block text-xs font-bold text-warm"
                          : "mt-2.5 inline-block text-xs font-bold text-accent"
                      }
                    >
                      {counter.against}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </ScrollReveal>

          <ScrollReveal delay={80}>
            <section>
              <h2 className="mb-4 text-lg font-bold text-ink">その他の機能</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {SECONDARY_FEATURES.map((item, i) => (
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
