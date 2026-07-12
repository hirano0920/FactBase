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

        {/* 要点→投票→議論を1枚のカードで最後まで流す（issues/[slug]/page.tsxと同じ理由）。
            議論は投票するまで完全に隠す＝投票が唯一の入口にする */}
        <Section id="vote-panel" variant="arena">
          <SectionTitle>要点</SectionTitle>
          <SummaryCard
            summary={issue.summary}
            articleSlug={issue.articleHtml ? issue.slug : undefined}
            debateType={issue.debateType}
          />

          <div className="mt-6 border-t border-border pt-6 text-center">
            <p className="mb-4 text-base font-bold text-ink">あなたはどう思いますか？</p>
            <div className="mx-auto max-w-md">
              <IssueVoteSlot
                issueId={issue.id}
                initialTally={issue.voteTally}
                labels={issue.voteLabels}
              />
            </div>
          </div>

          <div id="discussion" className="mt-6 border-t border-border pt-6">
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
