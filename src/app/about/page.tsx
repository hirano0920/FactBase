import Image from "next/image";
import Link from "next/link";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer } from "@/components/layout/page-container";
import { MAIN_SIDEBAR_GRID, SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `${SITE.name}を知る`,
  description:
    `${SITE.name}が対抗する2つの敵（偏向報道・フィルターバブル）と、その対抗策。第3のメディアとしての中立な討論会場。`,
};

/**
 * 「敵→対抗策」を1つのトラックとして持たせる。以前は敵カードと対抗策カードを別々のグリッドに
 * 並べていたが、見た目上つながりが分からず単なる同型カードの羅列に見えていた。
 * トラックにすることで、色付きの縦線1本で問題→解決の因果を直接つなぐ。
 */
const TRACKS = [
  {
    tag: "オールドメディア型",
    enemy: "偏向報道",
    description: "1社の切り取り方だけを読まされ、他の見方があることに気づけない。",
    tone: "warm",
    counters: [
      {
        title: "複数媒体を横断参照",
        description: "1つの争点につき複数の報道・一次情報を突き合わせてから要約するので、1社の偏向に引っ張られません。",
      },
      {
        title: "複数AIモデルで品質チェック",
        description: "記事を書くAIと、出典と照合して採点するAIを分離（Grok 4.3で生成→ChatGPT 5 nanoが独立照合）。書いた本人に採点させないので、AI自身の偏りも防ぎます。",
      },
    ],
  },
  {
    tag: "SNS型",
    enemy: "フィルターバブル",
    description: "おすすめアルゴリズムが同意見ばかり並べ、声の大きい極端な意見が勝つ。",
    tone: "accent",
    counters: [
      {
        title: "スプリットスレッド",
        description: "画面を最初からFOR/AGAINSTに分けて表示。相手陣営からも支持された意見（越境評価）が上に来る仕組みで、声の大きい極端な意見だけが目立つ状態を防ぎます。",
      },
      {
        title: "おすすめアルゴリズムなし",
        description: "あなたの好みに最適化されたタイムラインは存在しません。争点・新着・投票結果だけが並びます。",
      },
    ],
  },
] as const;

export default function AboutPage() {
  return (
    <PageContainer>
      <div className={`grid gap-8 ${MAIN_SIDEBAR_GRID}`}>
        <div className="min-w-0 max-w-content space-y-12">
          <ScrollReveal>
            <header className="max-w-2xl">
              <div className="mb-5 h-1 w-12 rounded-full bg-gradient-to-r from-accent to-hot" aria-hidden />
              <p className="mb-3 text-xs font-extrabold tracking-[0.2em] text-ink-faint">究極の命題</p>
              <h1 className="max-w-[16ch] text-3xl font-extrabold leading-[1.4] tracking-tight text-ink text-balance sm:text-4xl">
                まともな
                <span className="bg-gradient-to-r from-accent to-hot bg-clip-text text-transparent">議論</span>
                ができる環境を、日本のネットに作る。
              </h1>
              <p className="mt-5 max-w-prose text-base leading-relaxed text-ink-secondary">
                オールドメディアの偏向と、SNSのフィルターバブル。この2つに挟まれた人が、
                声の大きさでなく納得感で意見を磨ける場所を目指しています。
              </p>
            </header>
          </ScrollReveal>

          <ScrollReveal delay={60}>
            <section>
              <div className="mb-6 flex items-center gap-2">
                <h2 className="text-xs font-extrabold tracking-[0.15em] text-ink-faint">
                  2つの敵と、{SITE.name}の対抗策
                </h2>
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>

              <div className="grid gap-8 sm:grid-cols-2 sm:gap-10">
                {TRACKS.map((track) => (
                  <div
                    key={track.enemy}
                    className={
                      track.tone === "warm"
                        ? "border-l-[3px] border-warm/60 pl-5"
                        : "border-l-[3px] border-accent/60 pl-5"
                    }
                  >
                    <span
                      className={
                        track.tone === "warm"
                          ? "text-[11px] font-extrabold tracking-wide text-warm"
                          : "text-[11px] font-extrabold tracking-wide text-accent"
                      }
                    >
                      {track.tag}
                    </span>
                    <p className="mt-1 text-xl font-extrabold tracking-tight text-ink">{track.enemy}</p>
                    <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{track.description}</p>

                    <div className="mt-6 space-y-4">
                      {track.counters.map((counter) => (
                        <div key={counter.title} className="flex gap-2.5">
                          <svg
                            className={cn(
                              "mt-0.5 h-4 w-4 shrink-0",
                              track.tone === "warm" ? "text-warm" : "text-accent",
                            )}
                            viewBox="0 0 20 20"
                            fill="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
                              fill="currentColor"
                            />
                          </svg>
                          <div>
                            <p className="text-sm font-bold text-ink">{counter.title}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{counter.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
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
