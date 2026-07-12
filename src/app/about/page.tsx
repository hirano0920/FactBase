import Image from "next/image";
import Link from "next/link";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer } from "@/components/layout/page-container";
import { MAIN_SIDEBAR_GRID, SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { BridgingDemo } from "@/components/about/bridging-demo";
import { DistributionBars } from "@/components/about/distribution-bars";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `${SITE.name}を知る`,
  description:
    `${SITE.name}が対抗する2つの敵（偏向報道・フィルターバブル）と、その対抗策。第3のメディアとしての中立な討論会場。`,
};

/**
 * 「敵→対抗策」を1つのトラックとして持たせる。以前は敵と対抗策を1つの2カラムグリッドに
 * 詰め込んでいたが、1箇所に情報が密集して単調な文字の壁になっていた。
 * 今回は敵1つにつき横幅いっぱいの帯を1枚使い、縦の余白と左右反転で読むリズムを作る。
 * コピーも「説明文」から「短いラベル」に削って、密度そのものを落とす。
 */
const TRACKS = [
  {
    tag: "オールドメディア型",
    enemy: "偏向報道",
    description: "1社の切り取り方だけを読まされ、他の見方に気づけない。",
    tone: "warm",
    counters: [
      { title: "複数媒体を横断参照", description: "報道・一次情報を複数突き合わせてから要約。" },
      { title: "複数AIモデルで品質チェック", description: "書くAIと採点するAIを分離。書いた本人には採点させない。" },
    ],
  },
  {
    tag: "SNS型",
    enemy: "フィルターバブル",
    description: "アルゴリズムが同意見ばかり並べ、極端な意見が勝つ。",
    tone: "accent",
    counters: [
      { title: "スプリットスレッド", description: "画面を最初からFOR/AGAINSTに分割し、越境評価で並び替え。" },
      { title: "おすすめアルゴリズムなし", description: "好みに最適化されたタイムラインは存在しない。" },
    ],
  },
] as const;

const RIVALS = [
  { name: "X / Grok", weakness: "出典なし、賛否が見えない" },
  { name: "Yahooリアルタイム", weakness: "気分の集計止まりで受け身" },
  { name: "まとめサイト", weakness: "噂・偏向・匿名の煽り" },
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

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-extrabold tracking-[0.15em] text-ink-faint">
                2つの敵と、{SITE.name}の対抗策
              </h2>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </div>

            {TRACKS.map((track, i) => (
              <ScrollReveal key={track.enemy} delay={i * 80}>
                <section
                  className={cn(
                    "flex flex-col gap-6 rounded-[28px] px-6 py-10 sm:gap-10 sm:px-10 sm:py-12 lg:flex-row lg:items-center",
                    track.tone === "warm" ? "bg-warm-muted/60" : "bg-accent-soft/70",
                    i % 2 === 1 && "lg:flex-row-reverse",
                  )}
                >
                  <div className="lg:w-[38%] lg:shrink-0">
                    <span
                      className={cn(
                        "text-[11px] font-extrabold tracking-wide",
                        track.tone === "warm" ? "text-warm" : "text-accent",
                      )}
                    >
                      {track.tag}
                    </span>
                    <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                      {track.enemy}
                    </p>
                    <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink-secondary">
                      {track.description}
                    </p>
                  </div>

                  <div className="grid flex-1 gap-4 sm:grid-cols-2">
                    {track.counters.map((counter) => (
                      <div
                        key={counter.title}
                        className="rounded-2xl bg-surface/80 p-5 backdrop-blur-sm dark:bg-surface-raised/70"
                      >
                        <svg
                          className={cn("h-5 w-5", track.tone === "warm" ? "text-warm" : "text-accent")}
                          viewBox="0 0 20 20"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
                            fill="currentColor"
                          />
                        </svg>
                        <p className="mt-2.5 text-sm font-bold text-ink">{counter.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{counter.description}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </ScrollReveal>
            ))}

            <ScrollReveal delay={160}>
              <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-center text-xs text-ink-faint">
                <span className="font-bold text-ink-muted">具体的には —</span>
                {RIVALS.map((rival, i) => (
                  <span key={rival.name} className="inline-flex items-center gap-1.5">
                    {i > 0 && <span aria-hidden>·</span>}
                    <span className="font-semibold text-ink-secondary">{rival.name}</span>
                    <span>（{rival.weakness}）</span>
                  </span>
                ))}
              </p>
            </ScrollReveal>
          </div>

          <ScrollReveal>
            <section className="rounded-[28px] border border-border px-6 py-12 text-center sm:px-10 sm:py-16">
              <p className="text-xs font-extrabold tracking-[0.15em] text-accent">越境評価（bridging）</p>
              <h2 className="mx-auto mt-3 max-w-md text-2xl font-extrabold leading-snug tracking-tight text-ink text-balance sm:text-3xl">
                勝つのは、いいねの数でなく
                <br />
                相手陣営を動かした説得力。
              </h2>
              <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-secondary">
                賛否スレッドの並び順は、賛成派・反対派それぞれの支持数ではなく
                <strong className="font-bold text-ink">「反対陣営の投票者からも参考になったと言われた数」</strong>
                で決まります。同調圏のいいねが勝つ場では起きない仕組みです。
              </p>
              <div className="mx-auto mt-8 max-w-md">
                <BridgingDemo />
              </div>
            </section>
          </ScrollReveal>

          <ScrollReveal>
            <section className="rounded-[28px] border border-border px-6 py-12 sm:px-10 sm:py-16">
              <div className="mx-auto max-w-md text-center">
                <p className="text-xs font-extrabold tracking-[0.15em] text-accent">沈黙の多数派</p>
                <h2 className="mx-auto mt-3 text-2xl font-extrabold leading-snug tracking-tight text-ink text-balance sm:text-3xl">
                  騒いでいるのは両端の1%。
                  <br />
                  真ん中の99%は、ただ静かなだけ。
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-ink-secondary">
                  両論を読んだ後の立ち位置を、賛成/反対の2択でなく連続スライダーで取り、分布そのものを可視化します。
                  「90%が怒っている」ではなく、実際の理性的な立場分布を見せます。
                </p>
              </div>
              <div className="mx-auto mt-8 max-w-md">
                <DistributionBars />
              </div>
            </section>
          </ScrollReveal>

          <ScrollReveal>
            <section className="px-2 py-6 text-center sm:py-10">
              <p className="mx-auto max-w-lg text-xl font-extrabold leading-relaxed tracking-tight text-ink sm:text-2xl">
                AIは、賛成と反対の
                <span className="text-ink-faint">勝敗を宣言しません。</span>
                <br />
                その代わり
                <span className="bg-gradient-to-r from-accent to-hot bg-clip-text text-transparent">
                  「あなたの意見が何人を動かしたか」
                </span>
                を見せます。
              </p>
              <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-secondary">
                価値の対立に、AIが決めていい正解はありません。決着感は陣営の勝敗でなく、
                MVPや影響力スコアという個人の栄誉で。負けた側を作らない設計です。
              </p>
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
