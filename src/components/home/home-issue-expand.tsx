"use client";

import { useEffect } from "react";
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
  /** trueならマウント直後に投票パネルまで飛ばす（スレッド目当てのユーザーが要点を読み飛ばせるように） */
  scrollToVote?: boolean;
}

export function HomeIssueExpand({ issue, guestComments, onBack, scrollToVote = false }: HomeIssueExpandProps) {
  useEffect(() => {
    if (!scrollToVote) return;
    requestAnimationFrame(() => {
      document.getElementById("vote-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          </div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">
              {issue.title}
            </h2>
            <IssueBookmarkSlot slug={issue.slug} />
          </div>
        </header>

        <Section variant="arena">
          <SectionTitle>要点</SectionTitle>
          <SummaryCard
            summary={issue.summary}
            articleSlug={issue.articleHtml ? issue.slug : undefined}
            debateType={issue.debateType}
          />
        </Section>

        {/* 投票と議論は1枚のカードに統合する（issues/[slug]/page.tsxと同じ理由:
            別々の箱だと二陣営の対立が分断されて見える上、投票→スレッドの導線が途切れる） */}
        <Section id="vote-panel" variant="arena" className="!p-0 overflow-hidden">
          <div className="p-4 pb-2 sm:p-8 sm:pb-3">
            <SectionTitle className="mb-1">投票 &amp; 議論</SectionTitle>
            <p className="mb-4 text-xs text-ink-faint sm:mb-5">
              投票すると議論に参加でき、相手陣営にも響く意見が上位に並びます
            </p>
            <div className="mx-auto max-w-md">
              <IssueVoteSlot
                issueId={issue.id}
                initialTally={issue.voteTally}
                labels={issue.voteLabels}
              />
            </div>
          </div>
          <div className="border-t border-border p-4 pt-4 sm:p-8 sm:pt-6">
            <IssueCommentsSlot
              slug={issue.slug}
              issueId={issue.id}
              commentCount={issue.commentCount}
              voteTally={issue.voteTally}
            />
          </div>
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
