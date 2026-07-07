import Image from "next/image";
import Link from "next/link";
import { AboutDifferentiatorCard } from "@/components/about/about-differentiator-card";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer } from "@/components/layout/page-container";
import { MAIN_SIDEBAR_GRID } from "@/lib/constants";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FactBaseを知る",
  description:
    "FactBaseの目的、他SNSとの違い、Radar・Check、立ち上げ人情報。一次情報にもとづく投票・議論の場。",
};

const DIFFERENTIATORS = [
  {
    title: "恣意的な並び順がない",
    description: "おすすめ表示は使わず、投票数とコメント数だけがHot順を決めます。",
  },
  {
    title: "一次情報にもとづく整理",
    description: "Radarが争点を検知し、Checkが主張を一次情報と照合します（ワンタップFCはPlus / Pro）。",
  },
  {
    title: "荒らし対策としての登録制",
    description: "閲覧・投票は誰でも無料。コメントもログインすれば無料。荒らし対策のため登録制にしています。",
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
              <p className="text-xs font-bold tracking-widest text-accent">ABOUT</p>
              <h1 className="text-3xl font-extrabold tracking-tight text-ink">
                「おすすめ」のアルゴリズムは、ひとつもありません。
              </h1>
              <p className="text-base leading-relaxed text-ink-secondary">
                投票数とコメント数だけが並び順を決める、
                <strong className="font-semibold text-ink">
                  政治・経済・金融・財政・為替・戦争・歴史・人権など時事問題を議論する場所
                </strong>
                です。
              </p>
              <p className="text-sm leading-relaxed text-ink-muted">
                記事を選別・作成する <strong className="font-medium text-ink-secondary">FactBase Radar</strong>
                、コメントをチェックする <strong className="font-medium text-ink-secondary">FactBase Check</strong>
                は、日本国内および世界各地の一次情報データに基づく独自データベースを利用します。デマに溢れた現代で、情報をファクトに基づきわかりやすく整理して提供します。
              </p>
            </header>
          </ScrollReveal>

          <ScrollReveal delay={60}>
            <section>
              <h2 className="mb-4 text-lg font-bold text-ink">他のSNSとの違い</h2>
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
                    両親が教師の家庭で育ち、中学生頃から教育改革に興味を持ち、政治の道を志しました。慶應義塾大学入学後、様々なアプリを開発する中で、日本でファクトに基づき冷静に政治を語る場がオンライン上にないことに危機感を覚え、FactBase.tokyo
                    を立ち上げました。
                  </p>
                  <p className="text-xs text-ink-faint">
                    特定の政党・思想を支持するサービスではありません。判断基準はすべて一次情報です。
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
