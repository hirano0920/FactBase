"use client";

import { SummaryCard } from "@/components/issue/summary-card";
import {
  IssueBookmarkSlot,
  IssueCommentsSlot,
  IssueQualityReportSlot,
  IssueViewerProvider,
  IssueVoteSlot,
} from "@/components/issue/issue-viewer-context";
import { CategoryBadge, StatusBadge } from "@/components/ui/badge";
import { AdSlotGated } from "@/components/layout/ad-slot-gated";
import { Section, SectionTitle } from "@/components/layout/page-container";
import type { Comment, Issue } from "@/types";

interface HomeIssueExpandProps {
  issue: Issue;
  guestComments: Comment[];
  onBack: () => void;
}

export function HomeIssueExpand({ issue, guestComments, onBack }: HomeIssueExpandProps) {
  return (
    <div className="home-expand-enter space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-bold text-ink-secondary hover:text-ink"
      >
        <span aria-hidden>←</span> 一覧に戻る
      </button>

      <IssueViewerProvider slug={issue.slug} issueId={issue.id} guestComments={guestComments}>
        <header>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <CategoryBadge category={issue.category} />
            <StatusBadge status={issue.status} />
            {issue.confirmation === "reported" && (
              <span className="rounded-full border border-hot/40 bg-hot-muted px-2.5 py-0.5 text-xs font-medium text-hot">
                🔴 速報・続報中
              </span>
            )}
          </div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">
              {issue.title}
            </h2>
            <IssueBookmarkSlot slug={issue.slug} />
          </div>
        </header>

        <Section>
          <SectionTitle>要点</SectionTitle>
          <SummaryCard
            summary={issue.summary}
            articleSlug={issue.articleHtml ? issue.slug : undefined}
          />
        </Section>

        <Section>
          <SectionTitle>あなたの一票</SectionTitle>
          <div className="mx-auto max-w-md">
            <IssueVoteSlot
              issueId={issue.id}
              initialTally={issue.voteTally}
              labels={issue.voteLabels}
            />
          </div>
        </Section>

        <Section>
          <IssueCommentsSlot issueId={issue.id} commentCount={issue.commentCount} />
        </Section>

        {issue.confirmation !== null && (
          <div className="text-center">
            <IssueQualityReportSlot slug={issue.slug} />
          </div>
        )}

        <AdSlotGated slug={issue.slug} label="フッター広告" />
      </IssueViewerProvider>
    </div>
  );
}
