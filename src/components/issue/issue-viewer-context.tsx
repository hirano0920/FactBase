"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BookmarkButton } from "@/components/issue/bookmark-button";
import { CommentSection } from "@/components/issue/comment-section";
import { QualityReportButton } from "@/components/issue/quality-report-button";
import { VotePanelLive } from "@/components/issue/vote-panel-live";
import type { VoteChoiceId } from "@/lib/constants";
import type { Comment, VoteLabels, VoteTally } from "@/types";
import type { Plan } from "@prisma/client";

interface ViewerResponseGuest {
  isLoggedIn: false;
}

interface ViewerResponseAuthed {
  isLoggedIn: true;
  plan: Plan;
  userVote: VoteChoiceId | null;
  bookmarked: boolean;
}

type ViewerResponse = ViewerResponseGuest | ViewerResponseAuthed;

interface IssueViewerContextValue {
  loaded: boolean;
  isLoggedIn: boolean;
  plan: Plan | null;
  userVote: VoteChoiceId | null;
  bookmarked: boolean;
  comments: Comment[];
  nextCursor: string | null;
}

const IssueViewerContext = createContext<IssueViewerContextValue | null>(null);

function useIssueViewer(): IssueViewerContextValue {
  const ctx = useContext(IssueViewerContext);
  if (!ctx) throw new Error("IssueViewerProvider required");
  return ctx;
}

interface IssueViewerProviderProps {
  slug: string;
  issueId: string;
  guestComments: Comment[];
  children: ReactNode;
}

export function IssueViewerProvider({
  slug,
  issueId,
  guestComments,
  children,
}: IssueViewerProviderProps) {
  const [loaded, setLoaded] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [userVote, setUserVote] = useState<VoteChoiceId | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [comments, setComments] = useState(guestComments);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const viewerRes = await fetch(`/api/issues/${encodeURIComponent(slug)}/viewer`);
        if (!viewerRes.ok || cancelled) return;

        const viewer = (await viewerRes.json()) as ViewerResponse;
        if (!viewer.isLoggedIn) return;

        setIsLoggedIn(true);
        setPlan(viewer.plan);
        setUserVote(viewer.userVote);
        setBookmarked(viewer.bookmarked);

        const commentsRes = await fetch(
          `/api/comments?issueId=${encodeURIComponent(issueId)}`,
        );
        if (!commentsRes.ok || cancelled) return;

        const page = (await commentsRes.json()) as {
          comments: Comment[];
          nextCursor: string | null;
        };
        setComments(page.comments);
        setNextCursor(page.nextCursor);
      } catch {
        // ゲスト表示のまま継続
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, issueId]);

  const value = useMemo(
    () => ({
      loaded,
      isLoggedIn,
      plan,
      userVote,
      bookmarked,
      comments,
      nextCursor,
    }),
    [loaded, isLoggedIn, plan, userVote, bookmarked, comments, nextCursor],
  );

  return (
    <IssueViewerContext.Provider value={value}>{children}</IssueViewerContext.Provider>
  );
}

export function IssueBookmarkSlot({ slug }: { slug: string }) {
  const { loaded, isLoggedIn, bookmarked } = useIssueViewer();
  return (
    <BookmarkButton
      slug={slug}
      initialBookmarked={bookmarked}
      isLoggedIn={isLoggedIn}
      key={loaded ? "viewer-ready" : "viewer-guest"}
    />
  );
}

interface IssueVoteSlotProps {
  issueId: string;
  initialTally: VoteTally;
  labels?: VoteLabels | null;
}

export function IssueVoteSlot({ issueId, initialTally, labels }: IssueVoteSlotProps) {
  const { loaded, isLoggedIn, userVote } = useIssueViewer();
  return (
    <VotePanelLive
      issueId={issueId}
      initialTally={initialTally}
      initialUserVote={userVote}
      isLoggedIn={isLoggedIn}
      labels={labels}
      key={loaded ? "viewer-ready" : "viewer-guest"}
    />
  );
}

interface IssueCommentsSlotProps {
  issueId: string;
  commentCount: number;
}

export function IssueCommentsSlot({ issueId, commentCount }: IssueCommentsSlotProps) {
  const { loaded, isLoggedIn, plan, comments, nextCursor } = useIssueViewer();
  const canComment = plan === "COMMENT" || plan === "FACTCHECK";
  const canFactCheck = plan === "FACTCHECK";

  return (
    <CommentSection
      issueId={issueId}
      initialComments={comments}
      initialCursor={nextCursor}
      commentCount={commentCount}
      canComment={canComment}
      canFactCheck={canFactCheck}
      isLoggedIn={isLoggedIn}
      key={loaded ? "viewer-ready" : "viewer-guest"}
    />
  );
}

export function IssueQualityReportSlot({ slug }: { slug: string }) {
  const { isLoggedIn } = useIssueViewer();
  return <QualityReportButton slug={slug} isLoggedIn={isLoggedIn} />;
}
