import { notFound } from "next/navigation";
import { SummaryCard } from "@/components/issue/summary-card";
import { IssueTimelineLive } from "@/components/issue/issue-timeline-live";
import {
  IssueBookmarkSlot,
  IssueCommentsSlot,
  IssueQualityReportSlot,
  IssueViewerProvider,
  IssueVoteSlot,
} from "@/components/issue/issue-viewer-context";
import { CategoryBadge, StatusBadge } from "@/components/ui/badge";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { AdSlot, PageContainer, Section, SectionTitle } from "@/components/layout/page-container";
import { getComments, getIssueBySlug, getIssueTimeline, isDbEnabled } from "@/lib/data";
import { GUEST_COMMENT_LIMIT, ISSUE_PAGE_REVALIDATE_SEC } from "@/lib/constants";
import type { Metadata } from "next";

/** ゲスト向け静的シェル。auth() を呼ばず ISR/CDN が効く。ログイン要素はクライアントで hydrate */
export const revalidate = ISSUE_PAGE_REVALIDATE_SEC;

interface IssuePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: IssuePageProps): Promise<Metadata> {
  const { slug } = await params;
  const issue = await getIssueBySlug(slug);
  if (!issue) return { title: "争点が見つかりません" };

  return {
    title: issue.title,
    description: issue.summary.lead,
    openGraph: {
      title: issue.title,
      description: issue.summary.lead,
      type: "article",
      images: [`/issues/${issue.slug}/opengraph-image`],
    },
    twitter: {
      card: "summary_large_image",
      title: issue.title,
      description: issue.summary.lead,
    },
  };
}

export default async function IssuePage({ params }: IssuePageProps) {
  const { slug } = await params;
  const issue = await getIssueBySlug(slug);
  if (!issue) notFound();

  const [commentPage, timeline] = await Promise.all([
    getComments(issue.id, undefined, GUEST_COMMENT_LIMIT),
    isDbEnabled() ? getIssueTimeline(issue.id) : Promise.resolve([]),
  ]);
  commentPage.nextCursor = null;

  const tally = issue.voteTally;

  return (
    <IssueViewerProvider slug={issue.slug} issueId={issue.id} guestComments={commentPage.comments}>
      <PageContainer>
        <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
          <div className="min-w-0">
            <AdSlot className="mb-8" />

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
                {issue.confirmation === "reported" && (
                  <span className="rounded-full border border-amber-500/40 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                    報道ベース・真偽未確認
                  </span>
                )}
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
              <Section>
                <SectionTitle>要点</SectionTitle>
                <SummaryCard summary={issue.summary} articleSlug={issue.slug} />
              </Section>

              <Section>
                <SectionTitle>あなたの一票</SectionTitle>
                <IssueVoteSlot
                  issueId={issue.id}
                  initialTally={tally}
                  labels={issue.voteLabels}
                />
              </Section>

              <IssueTimelineLive issueId={issue.id} initialEntries={timeline} />

              <Section>
                <IssueCommentsSlot issueId={issue.id} commentCount={issue.commentCount} />
              </Section>

              {issue.confirmation !== null && (
                <div className="text-center">
                  <IssueQualityReportSlot slug={issue.slug} />
                </div>
              )}

              <AdSlot label="フッター広告" />
            </div>
          </div>

          <AppSidebarStatic />
        </div>
      </PageContainer>
    </IssueViewerProvider>
  );
}
