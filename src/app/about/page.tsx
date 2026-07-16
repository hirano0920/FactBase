import Image from "next/image";
import Link from "next/link";
import { PageContainer } from "@/components/layout/page-container";
import { SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { HeroHighlight } from "@/components/ui/hero-highlight";
import { HeroMockupBackdrop } from "@/components/about/hero-mockup-backdrop";
import { MediaMarquee } from "@/components/about/media-marquee";
import { AiJudgeDemo } from "@/components/about/ai-judge-demo";
import { SplitThreadDemo } from "@/components/about/split-thread-demo";
import { BridgingBadgeDemo } from "@/components/about/bridging-badge-demo";
import { GlossaryDemo } from "@/components/about/glossary-demo";
import { QualityReportDemo } from "@/components/about/quality-report-demo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `${SITE.name}を知る`,
  description: `${SITE.name}が対抗する2つの課題（偏向報道・フィルターバブル）とその解決策。中立な記事と両論が見える議論場。`,
};

const CHALLENGES = [
  {
    tag: "オールドメディア型",
    title: "偏向報道",
    description: "1社の偏った切り取り方だけを読まされ、他の見方に気づけない。",
    tone: "warm" as const,
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
      </svg>
    ),
    counters: [
      {
        title: "複数媒体を横断参照",
        description: "90以上の国内外メディアの報道と政府機関の一次情報を突き合わせてから要約します。",
        demo: <MediaMarquee />,
      },
      {
        title: "AIによる品質ゲート",
        description: "記事を書くAIと品質を採点するAIを分離。根拠の甘い記事は自動ブロックされます。",
        demo: <AiJudgeDemo />,
      },
    ],
  },
  {
    tag: "SNS型",
    title: "フィルターバブル",
    description:
      "アルゴリズムが同意見ばかりを並べ、リプ欄は極端な意見だらけ。X（旧Twitter）では、似た思想の人が適当にリプを積み、いいねが集まればデマでも上に上がります。",
    tone: "accent" as const,
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
    counters: [
      {
        title: "スプリットスレッド",
        description: "画面を最初から賛成・反対・中立に分割し、自分と異なる意見も強制的に目に入る設計です。",
        demo: <SplitThreadDemo />,
      },
      {
        title: "越境評価",
        description:
          "コメントの並び順は「いいねの数」ではなく、自分と異なる立場や、まだ立場の決まっていない中立の人から「参考になった」と言われた数で決まります。",
        demo: <BridgingBadgeDemo />,
      },
    ],
  },
] as const;

const TRUST_PILLARS = [
  {
    title: "用語のバリアフリー",
    description: "難しい専門用語や政治用語には、その場で意味が分かるホバー用語集を用意しています。",
    demo: <GlossaryDemo />,
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.78.147 2.653.255" />
      </svg>
    ),
  },
  {
    title: "政党・思想からの独立",
    description: "特定の政党・勢力・支持団体から一切の支援を受けていません。判断基準は争点素材とコミュニティの越境評価だけです。",
    demo: null,
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
  {
    title: "誤りの透明性",
    description: "読者からの品質報告が閾値に達すると、記事を消さずに「人間確認中」であることを明示します。",
    demo: <QualityReportDemo />,
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
  },
] as const;

export default function AboutPage() {
  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-24 sm:space-y-32">
        {/* ─── HERO ─── */}
        <ScrollReveal>
          <HeroHighlight
            containerClassName="min-h-[22rem] overflow-hidden rounded-[32px] border border-border sm:min-h-[32rem]"
            backdrop={<HeroMockupBackdrop />}
          >
            <header className="relative z-10 mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5 text-xs font-semibold text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                ミッション
              </div>
              <h1 className="mx-auto max-w-[18ch] text-balance text-3xl font-extrabold leading-[1.3] tracking-tight text-ink sm:text-4xl lg:text-5xl">
                まともな
                <span className="bg-gradient-to-r from-accent to-hot bg-clip-text text-transparent">議論</span>
                ができる環境を
                <br />
                日本のネット上に作る。
              </h1>
              <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-ink-secondary">
                オールドメディアの偏向報道と、SNSのフィルターバブル。
                この2つの課題に対抗し、中立的な記事と両論が見える議論場を目指します。
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <div className="flex items-center gap-2 text-sm text-ink-muted">
                  <svg viewBox="0 0 20 20" className="h-4 w-4 text-accent" fill="currentColor" aria-hidden>
                    <path fillRule="evenodd" d="M16.403 12.652a3 3 0 0 0 0-5.304 3 3 0 0 0-3.75-3.751 3 3 0 0 0-5.305 0 3 3 0 0 0-3.751 3.75 3 3 0 0 0 0 5.305 3 3 0 0 0 3.75 3.751 3 3 0 0 0 5.305 0 3 3 0 0 0 3.751-3.75Zm-2.546-4.46a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
                  </svg>
                  90+のメディアを横断参照
                </div>
                <div className="flex items-center gap-2 text-sm text-ink-muted">
                  <svg viewBox="0 0 20 20" className="h-4 w-4 text-accent" fill="currentColor" aria-hidden>
                    <path fillRule="evenodd" d="M16.403 12.652a3 3 0 0 0 0-5.304 3 3 0 0 0-3.75-3.751 3 3 0 0 0-5.305 0 3 3 0 0 0-3.751 3.75 3 3 0 0 0 0 5.305 3 3 0 0 0 3.75 3.751 3 3 0 0 0 5.305 0 3 3 0 0 0 3.751-3.75Zm-2.546-4.46a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
                  </svg>
                  越境評価で並び替え
                </div>
              </div>
            </header>
          </HeroHighlight>
        </ScrollReveal>

        {/* ─── CHALLENGE → SOLUTION TRACKS ─── */}
        {CHALLENGES.map((challenge) => (
          <div key={challenge.title} className="space-y-10 sm:space-y-12">
            {/* Challenge intro */}
            <ScrollReveal>
              <div className="mx-auto max-w-lg text-center">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-extrabold tracking-[0.15em]",
                    challenge.tone === "warm" ? "text-warm" : "text-accent",
                  )}
                >
                  {challenge.icon}
                  {challenge.tag}
                </span>
                <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
                  {challenge.title}
                </h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-secondary">
                  {challenge.description}
                </p>
              </div>
            </ScrollReveal>

            {/* Solution cards */}
            <div className="grid gap-6 sm:gap-8">
              {challenge.counters.map((counter, ci) => (
                <ScrollReveal key={counter.title} delay={(ci + 1) * 100}>
                  <section
                    className={cn(
                      "group rounded-[28px] px-6 py-10 transition-all duration-300 sm:px-10 sm:py-12",
                      challenge.tone === "warm"
                        ? "bg-warm-muted/60 hover:bg-warm-muted/80"
                        : "bg-accent-soft/70 hover:bg-accent-soft/90",
                    )}
                  >
                    <div className="mx-auto max-w-lg text-center">
                      <div className="mb-3 inline-flex items-center justify-center gap-2">
                        <span
                          className={cn(
                            "h-0.5 w-6 rounded-full transition-all duration-300 group-hover:w-8",
                            challenge.tone === "warm" ? "bg-warm" : "bg-accent",
                          )}
                          aria-hidden
                        />
                        <h3 className="text-lg font-bold text-ink">{counter.title}</h3>
                        <span
                          className={cn(
                            "h-0.5 w-6 rounded-full transition-all duration-300 group-hover:w-8",
                            challenge.tone === "warm" ? "bg-warm" : "bg-accent",
                          )}
                          aria-hidden
                        />
                      </div>
                      <p className="text-sm leading-relaxed text-ink-muted">{counter.description}</p>
                    </div>
                    <div className="mx-auto mt-8 max-w-2xl">{counter.demo}</div>
                  </section>
                </ScrollReveal>
              ))}
            </div>
          </div>
        ))}

        {/* ─── TRUST PILLARS ─── */}
        <div className="space-y-10 sm:space-y-12">
          <ScrollReveal>
            <div className="text-center">
              <span className="text-xs font-extrabold tracking-[0.15em] text-ink-faint">
                信頼を支える設計
              </span>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
                記事の質だけじゃない。
                <br />
                設計思想そのものが違う。
              </h2>
            </div>
          </ScrollReveal>

          <div className="grid gap-6 md:grid-cols-3 md:gap-8">
            {TRUST_PILLARS.map((pillar, i) => (
              <ScrollReveal key={pillar.title} delay={(i + 1) * 80}>
                <section className="group flex h-full flex-col rounded-[24px] border border-border bg-surface px-6 py-8 text-center transition-all duration-300 hover:border-border-strong hover:shadow-md sm:px-8">
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center self-center rounded-xl bg-accent-soft/70 text-accent transition-colors duration-300 group-hover:bg-accent-soft">
                    {pillar.icon}
                  </div>
                  <h3 className="text-base font-bold text-ink">{pillar.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{pillar.description}</p>
                  {pillar.demo && <div className="mt-6">{pillar.demo}</div>}
                </section>
              </ScrollReveal>
            ))}
          </div>
        </div>

        {/* ─── CREATOR ─── */}
        <ScrollReveal>
          <section className="mx-auto max-w-2xl rounded-[28px] border border-border bg-surface-muted/50 px-6 py-10 sm:px-10 sm:py-12">
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:gap-8">
              <div className="shrink-0">
                <div className="overflow-hidden rounded-2xl border border-border">
                  <Image
                    src="/images/creator.png"
                    alt="平野大介"
                    width={110}
                    height={110}
                    className="object-cover object-top"
                    priority
                  />
                </div>
              </div>
              <div className="min-w-0 space-y-3 text-center sm:text-left">
                <div>
                  <p className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">平野 大介</p>
                  <p className="mt-1 text-sm font-bold tracking-widest text-accent">立ち上げ人</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    東京都町田市出身 · 現役慶應義塾大学1年生
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-ink-secondary">
                  SNSのフィルターバブルと偏向報道に疲れた人向けに、
                  中立で両論が見える討論場 {SITE.displayName} を立ち上げました。
                </p>
                <p className="text-xs leading-relaxed text-ink-faint">
                  特定の政党・思想を支持するサービスではありません。
                  判断基準は争点素材とコミュニティの越境評価です。
                </p>
              </div>
            </div>
          </section>
        </ScrollReveal>

        {/* ─── CTA ─── */}
        <ScrollReveal>
          <section className="rounded-[28px] bg-gradient-to-br from-accent to-hot px-6 py-12 text-center sm:px-10 sm:py-16">
            <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              今日の争点をチェックする
            </h2>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/80">
              登録不要で議論を読めます。投票やコメントは月額500円〜。
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-accent shadow-lg transition-all duration-200 hover:shadow-xl hover:brightness-110"
            >
              議論を見に行く
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
              </svg>
            </Link>
          </section>
        </ScrollReveal>

        {/* ─── FOOTER LINK ─── */}
        <ScrollReveal>
          <section className="border-t border-border pt-8 text-center text-sm text-ink-muted">
            <p>
              使用AI・インフラ・モデレーションの詳細は{" "}
              <Link
                href="/transparency"
                className="font-semibold text-link underline-offset-2 transition-colors duration-200 hover:text-link/80 hover:underline"
              >
                透明性ページ
              </Link>
              をご覧ください。
            </p>
          </section>
        </ScrollReveal>
      </div>
    </PageContainer>
  );
}
