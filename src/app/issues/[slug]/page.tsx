import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SummaryCard } from "@/components/issue/summary-card";
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
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { AdSlotGated } from "@/components/layout/ad-slot-gated";
import { PageContainer, Section, SectionTitle } from "@/components/layout/page-container";
import { LeftRail } from "@/components/layout/left-rail";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { getComments, getIssueBySlug, getIssueTimeline, isDbEnabled } from "@/lib/data";
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

  const [commentPage, timeline] = await Promise.all([
    getComments(issue.id, undefined, GUEST_COMMENT_LIMIT, "new", { includeReplies: false }),
    isDbEnabled() ? getIssueTimeline(issue.id) : Promise.resolve([]),
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
                <CategoryBadge category={issue.category} />
                <StatusBadge status={issue.status} />
                {issue.confirmation === "official" && (
                  <span className="rounded-full border border-for/30 bg-for-muted px-2.5 py-0.5 text-xs font-medium text-for">
                    公式発表あり
                  </span>
                )}
              </div>
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-4xl text-balance">
                  {issue.title}
                </h1>
                <div className="shrink-0 pt-1">
                  <IssueBookmarkSlot slug={issue.slug} />
                </div>
              </div>
            </header>

            <div className="space-y-6">
              <ScrollReveal>
                <Section variant="arena">
                  <SectionTitle>要点</SectionTitle>
                  <SummaryCard
                    summary={issue.summary}
                    articleSlug={issue.articleHtml ? issue.slug : undefined}
                    debateType={issue.debateType}
                  />
                </Section>
              </ScrollReveal>

              {/* 投票と議論は「別々の箱」だと二陣営の対立が分断されて見えるため、1枚のカードに統合する。
                  上段=投票（賛否バー）と下段=議論（賛否カラム）で色（for/against）を連続させ、
                  スプリット構造そのものを画面の主役にする */}
              <ScrollReveal delay={80}>
                <Section id="vote-panel" variant="arena" className="!p-0 overflow-hidden">
                  <div className="p-4 pb-2 sm:p-8 sm:pb-3">
                    <SectionTitle className="mb-1">投票 &amp; 議論</SectionTitle>
                    <p className="mb-4 text-xs text-ink-faint sm:mb-5">
                      投票すると議論に参加でき、相手陣営にも響く意見が上位に並びます
                    </p>
                    <div className="mx-auto max-w-md">
                      <IssueVoteSlot
                        issueId={issue.id}
                        initialTally={tally}
                        labels={issue.voteLabels}
                      />
                    </div>
                  </div>
                  <div className="border-t border-border p-4 pt-4 sm:p-8 sm:pt-6">
                    <Suspense fallback={null}>
                      <IssueCommentsSlot
                        slug={issue.slug}
                        issueId={issue.id}
                        commentCount={issue.commentCount}
                        voteTally={tally}
                      />
                    </Suspense>
                  </div>
                </Section>
              </ScrollReveal>

              {/* 更新タイムラインは「要点→投票」の間に挟むと読了までの距離が伸びるため、
                  投票・議論より後ろに退避する（記事はおまけ・スレッドが主役という前提） */}
              {timeline.length > 0 && (
                <ScrollReveal>
                  <IssueTimelineLive issueId={issue.id} initialEntries={timeline} />
                </ScrollReveal>
              )}

              <IssueSpectrumSlot slug={issue.slug} />

              <ScrollReveal>
                <Section variant="arena">
                  <SectionTitle>議論インテリジェンス</SectionTitle>
                  <IssueIntelligenceSlot slug={issue.slug} />
                </Section>
              </ScrollReveal>

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
