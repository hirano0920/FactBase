import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SummaryCard } from "@/components/issue/summary-card";
import { VideoEmbed } from "@/components/issue/video-embed";
import { YahooPollReference } from "@/components/issue/yahoo-poll-reference";
import { IssueTimelineLive } from "@/components/issue/issue-timeline-live";
import {
  IssueBookmarkSlot,
  IssueCommentsSlot,
  IssueQualityReportSlot,
  IssueIntelligenceSlot,
  IssueSpectrumSlot,
  IssueViewerProvider,
  IssueVoteSlot,
} from "@/components/issue/issue-viewer-context";
import { CategoryBadge, StatusBadge } from "@/components/ui/badge";
import { TrackBadge } from "@/components/issue/track-badge";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { AdSlotGated } from "@/components/layout/ad-slot-gated";
import { PageContainer, Section, SectionTitle } from "@/components/layout/page-container";
import { LeftRail } from "@/components/layout/left-rail";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import Link from "next/link";
import { getComments, getIssueBySlug, getIssueTimeline, getRelatedDebates, isDbEnabled } from "@/lib/data";
import { getVoteSwing } from "@/lib/vote-swing";
import { SwingIndicator } from "@/components/issue/swing-indicator";
import { GUEST_COMMENT_LIMIT, HOME_THREE_COL_GRID } from "@/lib/constants";
import type { Metadata } from "next";

/** ゲスト向け静的シェル。auth() を呼ばず ISR/CDN が効く。ログイン要素はクライアントで hydrate */
// Next.jsのセグメント設定はリテラルのみ許可のため、lib/constants.tsのISSUE_PAGE_REVALIDATE_SEC(3600)と値を同期
export const revalidate = 3600;

interface IssuePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: IssuePageProps): Promise<Metadata> {
  const { slug } = await params;
  const issue = await getIssueBySlug(slug);
  if (!issue) return { title: "争点が見つかりません" };

  // shareTitle（自分ごとフック）はX/SEO/OGだけに使う。ページ本体のtitle/H1は中立な投票設問のまま
  const hookTitle = issue.shareTitle || issue.title;

  return {
    title: hookTitle,
    description: issue.summary.lead,
    openGraph: {
      title: hookTitle,
      description: issue.summary.lead,
      type: "article",
      images: [`/issues/${issue.slug}/opengraph-image`],
    },
    twitter: {
      card: "summary_large_image",
      title: hookTitle,
      description: issue.summary.lead,
    },
  };
}

export default async function IssuePage({ params }: IssuePageProps) {
  const { slug } = await params;
  const issue = await getIssueBySlug(slug);
  if (!issue) notFound();

  const isNews = issue.track === "news";
  const [commentPage, timeline, swing, relatedDebates] = await Promise.all([
    getComments(issue.id, undefined, GUEST_COMMENT_LIMIT, "new", { includeReplies: false }),
    isDbEnabled() ? getIssueTimeline(issue.id) : Promise.resolve([]),
    isDbEnabled() ? getVoteSwing(issue.id) : Promise.resolve(null),
    isNews ? getRelatedDebates(slug) : Promise.resolve([]),
  ]);
  commentPage.nextCursor = null;

  const tally = issue.voteTally;

  return (
    <IssueViewerProvider slug={issue.slug} issueId={issue.id} guestComments={commentPage.comments}>
      <PageContainer>
        <div className={`grid gap-6 lg:gap-8 ${HOME_THREE_COL_GRID}`}>
          <div className="hidden xl:block">
            <LeftRail />
          </div>

          <div className="min-w-0">
            <AdSlotGated slug={issue.slug} className="mb-8" />

            {issue.underReview && (
              <div className="mb-6 rounded-md border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                複数の利用者からこの争点の内容について報告があり、現在人間のスタッフが内容を確認しています。
                投票・議論は引き続き可能です。
              </div>
            )}

            <header className="mb-8">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <TrackBadge track={issue.track} />
                <CategoryBadge category={issue.category} />
                <StatusBadge status={issue.status} />
                {issue.confirmation === "official" && (
                  <span className="rounded-full border border-for/30 bg-for-muted px-2.5 py-0.5 text-xs font-medium text-for">
                    公式発表あり
                  </span>
                )}
                {issue.confirmation === "reported" && (
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                    報道ベース・真偽は未確認
                  </span>
                )}
                {/* 5媒体前後を毎回自分で見比べなくて済む、というタイパの訴求。記事を開く前の
                    最初のスクリーンで見せることで「このサイトだけ見ればいい」を伝える */}
                {(issue.summary.sourceCount ?? issue.summary.sources?.length ?? 0) > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">
                    🔎 {issue.summary.sourceCount ?? issue.summary.sources.length}件のソースを参照
                  </span>
                )}
              </div>
              <div className="flex items-start justify-between gap-3">
                {/* H1はshareTitle（フック見出し）。投票設問のissue.titleは投票欄のみに出す。
                    voteQuestionが「是認？拒否？」に崩壊しても、ページ見出しは壊さない。 */}
                <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl text-balance">
                  {issue.shareTitle || issue.title}
                </h1>
                <div className="shrink-0 pt-1">
                  <IssueBookmarkSlot slug={issue.slug} />
                </div>
              </div>
            </header>

            <div className="space-y-6">
              {isNews ? (
                /* News: 解説メインの長めの要点→通常のコメント欄。投票も対立の軸も出さない */
                <ScrollReveal>
                  <Section variant="arena">
                    {/* 討論動画が元ネタの争点は、要点より先に動画そのものを見せる（§動画→30秒要約→議論の順） */}
                    {issue.video && (
                      <div className="mb-6">
                        <VideoEmbed video={issue.video} />
                      </div>
                    )}
                    <SectionTitle>要点</SectionTitle>
                    <SummaryCard
                      summary={issue.summary}
                      articleSlug={issue.articleHtml ? issue.slug : undefined}
                      debateType={issue.debateType}
                      glossary={issue.glossary}
                      variant="news"
                    />

                    {/* News=入り口 → Debate=本丸への導線。解説を読み終えた直後に「議論の場」を提示する */}
                    {relatedDebates.length > 0 && (
                      <div className="mt-6 border-t border-border pt-6">
                        <p className="mb-3 text-sm font-bold text-ink">🔥 この話題に関連する議論</p>
                        <ul className="space-y-2">
                          {relatedDebates.map((d) => (
                            <li key={d.slug}>
                              <Link
                                href={`/issues/${d.slug}`}
                                className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft/40 px-4 py-3 text-sm text-ink no-underline transition-colors hover:border-accent hover:bg-accent-soft"
                              >
                                <span className="min-w-0 flex-1">{d.title}</span>
                                <span className="shrink-0 text-xs font-semibold text-accent">
                                  {d.totalVotes > 0 && `${d.totalVotes}票 · `}
                                  {d.commentCount > 0 && `${d.commentCount}件の意見 · `}
                                  議論に参加 →
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div id="discussion" className="mt-6 border-t border-border pt-6">
                      <Suspense fallback={null}>
                        <IssueCommentsSlot
                          slug={issue.slug}
                          issueId={issue.id}
                          commentCount={issue.commentCount}
                          voteTally={tally}
                          track="news"
                        />
                      </Suspense>
                    </div>
                  </Section>
                </ScrollReveal>
              ) : (
                /* Debate: 要点→投票→議論を1枚のカードで最後まで流す。
                    「要点カード」「投票カード」と箱を分けると、読み終えるたびに区切りが入って
                    投票への勢いが途切れるため、対立の芯を読んだ流れのままボタンに指を伸ばせるようにする。
                    議論は投票するまで完全に隠す（プレビューも出さない）＝投票が唯一の入口にする */
                <ScrollReveal>
                  <Section id="vote-panel" variant="arena">
                    {/* 討論動画が元ネタの争点は、要点より先に動画そのものを見せる（動画→30秒要約→投票→議論の順） */}
                    {issue.video && (
                      <div className="mb-6">
                        <VideoEmbed video={issue.video} />
                      </div>
                    )}
                    <SectionTitle>要点</SectionTitle>
                    <SummaryCard
                      summary={issue.summary}
                      articleSlug={issue.articleHtml ? issue.slug : undefined}
                      debateType={issue.debateType}
                      glossary={issue.glossary}
                    />

                    <div className="mt-6 border-t border-border pt-6 text-center">
                      {/* ページ上部のH1と同じissue.titleをここでも再掲する。以前は
                          「あなたはどう思いますか？」という固定の汎用文言だったため、
                          争点ごとに具体的に作った設問（例:「国会前デモの抗議、妥当だと思いますか？」）が
                          投票の意思決定点では見えなくなっていた */}
                      <p className="mb-4 text-base font-bold text-ink">{issue.title}</p>
                      {issue.summary.externalPoll && (
                        <div className="mx-auto max-w-md text-left">
                          <YahooPollReference poll={issue.summary.externalPoll} />
                        </div>
                      )}
                      <div className="mx-auto max-w-md">
                        <IssueVoteSlot
                          issueId={issue.id}
                          initialTally={tally}
                          labels={issue.voteLabels}
                        />
                        <SwingIndicator
                          slug={issue.slug}
                          initialSwing={swing}
                          labels={issue.voteLabels}
                          shareTitle={issue.shareTitle || issue.title}
                        />
                      </div>
                    </div>

                    <div id="discussion" className="mt-6 border-t border-border pt-6">
                      <Suspense fallback={null}>
                        <IssueCommentsSlot
                          slug={issue.slug}
                          issueId={issue.id}
                          commentCount={issue.commentCount}
                          voteTally={tally}
                          track="debate"
                        />
                      </Suspense>
                    </div>
                  </Section>
                </ScrollReveal>
              )}

              {/* 更新タイムラインは「要点→投票」の間に挟むと読了までの距離が伸びるため、
                  投票・議論より後ろに退避する（記事はおまけ・スレッドが主役という前提） */}
              {timeline.length > 0 && (
                <ScrollReveal>
                  <IssueTimelineLive issueId={issue.id} initialEntries={timeline} />
                </ScrollReveal>
              )}

              {!isNews && <IssueSpectrumSlot slug={issue.slug} labels={issue.voteLabels} />}

              {!isNews && (
                <ScrollReveal>
                  <Section variant="arena">
                    <SectionTitle>議論インテリジェンス</SectionTitle>
                    <IssueIntelligenceSlot slug={issue.slug} />
                  </Section>
                </ScrollReveal>
              )}

              {issue.confirmation !== null && (
                <div className="text-center">
                  <IssueQualityReportSlot slug={issue.slug} />
                </div>
              )}

              <AdSlotGated slug={issue.slug} label="フッター広告" />
            </div>
          </div>

          <div className="hidden lg:block">
            <AppSidebarStatic />
          </div>
        </div>
      </PageContainer>
    </IssueViewerProvider>
  );
}
