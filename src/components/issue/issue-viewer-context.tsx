"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { BookmarkButton } from "@/components/issue/bookmark-button";
import { CommentSection } from "@/components/issue/comment-section";
import { QualityReportButton } from "@/components/issue/quality-report-button";
import { VotePanelLive } from "@/components/issue/vote-panel-live";
import { SpectrumVote } from "@/components/issue/spectrum-vote";
import { DebateIntelligencePanel } from "@/components/issue/debate-intelligence-panel";
import { Button } from "@/components/ui/button";
import type { VoteChoiceId } from "@/lib/constants";
import type { Comment, VoteLabels, VoteTally } from "@/types";
import type { Plan } from "@prisma/client";
import {
  canPostComment,
  canUseFactCheck,
  canViewAnalytics,
  canUseRebuttalAi,
} from "@/lib/plan-features";
import { fetchIssueViewer, hasLikelySessionCookie } from "@/lib/issue-viewer-client";

interface IssueViewerContextValue {
  /** viewer API（投票・プラン）が確定したか。コメント取得は待たない */
  viewerReady: boolean;
  /** ログイン時コメント一覧の取得完了 */
  commentsReady: boolean;
  isLoggedIn: boolean;
  plan: Plan | null;
  userVote: VoteChoiceId | null;
  bookmarked: boolean;
  comments: Comment[];
  nextCursor: string | null;
  /** 直近で初めて投票した選択肢。投票直後に「その理由をコメントで」導線を出すために使う */
  justVoted: VoteChoiceId | null;
  markJustVoted: (choice: VoteChoiceId) => void;
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
  // セッションcookieが無ければゲスト確定扱いで投票を即描画（viewer RTTを待たない）
  const [viewerReady, setViewerReady] = useState(() =>
    typeof document !== "undefined" ? !hasLikelySessionCookie() : false,
  );
  const [commentsReady, setCommentsReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [userVote, setUserVote] = useState<VoteChoiceId | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [comments, setComments] = useState(guestComments);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState<VoteChoiceId | null>(null);

  useEffect(() => {
    let cancelled = false;
    const guestLikely = !hasLikelySessionCookie();

    setViewerReady(guestLikely);
    setCommentsReady(false);
    setIsLoggedIn(false);
    setPlan(null);
    setUserVote(null);
    setBookmarked(false);
    setComments(guestComments);
    setNextCursor(null);
    setJustVoted(null);

    (async () => {
      try {
        const viewer = await fetchIssueViewer(slug);
        if (cancelled) return;

        if (!viewer.isLoggedIn) {
          setIsLoggedIn(false);
          setPlan(null);
          setUserVote(null);
          setBookmarked(false);
          setViewerReady(true);
          setCommentsReady(true);
          return;
        }

        setIsLoggedIn(true);
        setPlan(viewer.plan);
        setUserVote(viewer.userVote);
        setBookmarked(viewer.bookmarked);
        setViewerReady(true);

        // コメントは投票と独立に取る（投票ボタンをコメントRTTで待たせない）
        const commentsRes = await fetch(
          `/api/comments?issueId=${encodeURIComponent(issueId)}`,
        );
        if (!commentsRes.ok || cancelled) {
          setCommentsReady(true);
          return;
        }
        const page = (await commentsRes.json()) as {
          comments: Comment[];
          nextCursor: string | null;
        };
        if (cancelled) return;
        setComments(page.comments);
        setNextCursor(page.nextCursor);
        setCommentsReady(true);
      } catch {
        if (!cancelled) {
          setViewerReady(true);
          setCommentsReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // guestComments は初期表示用。参照が変わるたびに再fetchすると投票が何度もスケルトンに戻る
    // eslint-disable-next-line react-hooks/exhaustive-deps -- slug/issueId の遷移時のみ再取得
  }, [slug, issueId]);

  const markJustVoted = useCallback((choice: VoteChoiceId) => {
    setJustVoted(choice);
    setUserVote(choice);
  }, []);

  const value = useMemo(
    () => ({
      viewerReady,
      commentsReady,
      isLoggedIn,
      plan,
      userVote,
      bookmarked,
      comments,
      nextCursor,
      justVoted,
      markJustVoted,
    }),
    [
      viewerReady,
      commentsReady,
      isLoggedIn,
      plan,
      userVote,
      bookmarked,
      comments,
      nextCursor,
      justVoted,
      markJustVoted,
    ],
  );

  return (
    <IssueViewerContext.Provider value={value}>{children}</IssueViewerContext.Provider>
  );
}

export function IssueBookmarkSlot({ slug }: { slug: string }) {
  const { isLoggedIn, bookmarked } = useIssueViewer();
  return (
    <BookmarkButton
      slug={slug}
      initialBookmarked={bookmarked}
      isLoggedIn={isLoggedIn}
    />
  );
}

/**
 * 投票ボタンの読み込み中プレースホルダ。
 * ログイン済みの可能性があるときだけ出す（ゲストは即本描画）。
 */
function VoteSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      <div className="mx-auto h-11 max-w-[22rem] rounded-xl bg-surface-muted" />
      <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
        <div className="h-16 rounded-xl bg-surface-muted" />
        <div className="h-16 rounded-xl bg-surface-muted" />
        <div className="h-16 rounded-xl bg-surface-muted" />
      </div>
    </div>
  );
}

interface IssueVoteSlotProps {
  issueId: string;
  initialTally: VoteTally;
  labels?: VoteLabels | null;
}

export function IssueVoteSlot({ issueId, initialTally, labels }: IssueVoteSlotProps) {
  const { viewerReady, isLoggedIn, userVote, markJustVoted } = useIssueViewer();
  if (!viewerReady) return <VoteSkeleton />;
  return (
    <VotePanelLive
      issueId={issueId}
      initialTally={initialTally}
      initialUserVote={userVote}
      isLoggedIn={isLoggedIn}
      labels={labels}
      onFirstVote={markJustVoted}
    />
  );
}

interface IssueCommentsSlotProps {
  slug: string;
  issueId: string;
  commentCount: number;
  voteTally: VoteTally;
}

function VoteToUnlockGate({ commentCount }: { commentCount: number }) {
  const scrollToVote = () => {
    document.getElementById("vote-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="rounded-lg border-2 border-dashed border-border-strong bg-surface-muted px-6 py-10 text-center">
      <p className="mb-2 text-2xl" aria-hidden="true">
        🔒
      </p>
      <p className="mb-1.5 text-base font-bold text-ink">投票すると議論が見られます</p>
      <p className="mb-4 text-sm text-ink-secondary">
        {commentCount > 0
          ? `すでに${commentCount}件の意見が投稿されています。まずは上の投票からどうぞ。`
          : "まずは上の投票から参加してください。"}
      </p>
      <Button variant="primary" size="sm" onClick={scrollToVote}>
        投票する
      </Button>
    </div>
  );
}

function CommentsSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-hidden="true">
      <div className="h-5 w-16 rounded bg-surface-muted" />
      <div className="h-10 rounded-full bg-surface-muted" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-28 rounded-xl bg-surface-muted" />
        <div className="h-28 rounded-xl bg-surface-muted" />
      </div>
    </div>
  );
}

export function IssueCommentsSlot({ slug, issueId, commentCount, voteTally }: IssueCommentsSlotProps) {
  const { viewerReady, commentsReady, isLoggedIn, plan, userVote, comments, nextCursor, justVoted } =
    useIssueViewer();
  const canComment = canPostComment(isLoggedIn);
  const canFactCheck = canUseFactCheck(plan);
  const canRebuttalAi = canUseRebuttalAi(plan);

  // 投票ゲート判定には viewer だけ必要。未投票ならコメント取得完了を待たずゲートを出す
  if (!viewerReady) return <CommentsSkeleton />;
  if (!userVote) {
    return <VoteToUnlockGate commentCount={commentCount} />;
  }
  if (!commentsReady) return <CommentsSkeleton />;

  return (
    <CommentSection
      issueId={issueId}
      issueSlug={slug}
      initialComments={comments}
      initialCursor={nextCursor}
      commentCount={commentCount}
      canComment={canComment}
      canFactCheck={canFactCheck}
      canRebuttalAi={canRebuttalAi}
      userVote={userVote}
      isLoggedIn={isLoggedIn}
      promptStance={justVoted}
      voteTally={voteTally}
    />
  );
}

export function IssueQualityReportSlot({ slug }: { slug: string }) {
  const { isLoggedIn } = useIssueViewer();
  return <QualityReportButton slug={slug} isLoggedIn={isLoggedIn} />;
}

export function IssueSpectrumSlot({ slug, labels }: { slug: string; labels?: VoteLabels | null }) {
  const { isLoggedIn, plan, userVote } = useIssueViewer();
  if (!isLoggedIn || !userVote) return null;
  return <SpectrumVote slug={slug} canViewDetail={canViewAnalytics(plan)} labels={labels} />;
}

export function IssueIntelligenceSlot({ slug }: { slug: string }) {
  const { plan } = useIssueViewer();
  const isPlus = plan === "COMMENT" || plan === "FACTCHECK";
  return <DebateIntelligencePanel slug={slug} isPlus={isPlus} />;
}
