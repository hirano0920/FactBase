"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
  const [loaded, setLoaded] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [userVote, setUserVote] = useState<VoteChoiceId | null>(null);
  const [bookmarked, setBookmarked] = useState(false);
  const [comments, setComments] = useState(guestComments);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [justVoted, setJustVoted] = useState<VoteChoiceId | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 争点ページ間のクライアント遷移で前の争点の投票・コメントが一瞬残るのを防ぐ
    setLoaded(false);
    setIsLoggedIn(false);
    setPlan(null);
    setUserVote(null);
    setBookmarked(false);
    setComments(guestComments);
    setNextCursor(null);
    setJustVoted(null);

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
  }, [slug, issueId, guestComments]);

  // 投票直後の合図(justVoted)だけでなく、コメント欄のゲート判定に使うuserVote本体もここで更新する。
  // これを怠ると、投票パネル自身は(ローカルstateで)即座に投票済み表示になる一方、
  // コメント欄は共有コンテキストの古いuserVote(null)を見続けて「投票してください」と出続けるバグになる。
  const markJustVoted = useCallback((choice: VoteChoiceId) => {
    setJustVoted(choice);
    setUserVote(choice);
  }, []);

  const value = useMemo(
    () => ({
      loaded,
      isLoggedIn,
      plan,
      userVote,
      bookmarked,
      comments,
      nextCursor,
      justVoted,
      markJustVoted,
    }),
    [loaded, isLoggedIn, plan, userVote, bookmarked, comments, nextCursor, justVoted, markJustVoted],
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
 * 投票ボタンの読み込み中プレースホルダ。isLoggedIn/userVoteが未確定のまま描画すると、
 * 「未ログイン・未投票」というゲスト既定値でボタンが一瞬出たあとログイン済み/投票済みの
 * 本来の状態に切り替わる、という見た目のチラつきが起きる。loadedが確定するまでは
 * 中身を出さずスケルトンだけ見せて、確定後に一度で正しい状態を描画する
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
  const { loaded, isLoggedIn, userVote, markJustVoted } = useIssueViewer();
  if (!loaded) return <VoteSkeleton />;
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

/**
 * 未投票者向けの投票ゲート。ゲスト・ログイン済み未投票の両方が対象
 * （以前はゲストだけプレビューを見せていたが、「一票入れるまで議論は見せない」に統一した）。
 */
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

/** 議論欄の読み込み中プレースホルダ。理由はVoteSkeletonと同じ（loaded確定までチラつかせない） */
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
  const { loaded, isLoggedIn, plan, userVote, comments, nextCursor, justVoted } = useIssueViewer();
  const canComment = canPostComment(isLoggedIn);
  const canFactCheck = canUseFactCheck(plan);
  const canRebuttalAi = canUseRebuttalAi(plan);

  // isLoggedIn/userVoteが未確定のまま描画すると、ゲスト既定表示→本来の状態への
  // チラつきが起きるため、loadedが確定するまではスケルトンだけ見せる
  if (!loaded) return <CommentsSkeleton />;

  // 一票入れるまでは議論を一切見せない（ゲストもログイン済み未投票も同じ扱い）
  if (!userVote) {
    return <VoteToUnlockGate commentCount={commentCount} />;
  }

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

/** 投票済みログインユーザーにのみ「読了後スライダー」を出す(未投票者はそもそも議論が見えていないため) */
export function IssueSpectrumSlot({ slug }: { slug: string }) {
  const { isLoggedIn, plan, userVote } = useIssueViewer();
  if (!isLoggedIn || !userVote) return null;
  return <SpectrumVote slug={slug} canViewDetail={canViewAnalytics(plan)} />;
}

/** 層の動き・両陣営マップ・MVP（Freeは概要、Plus/Proは詳細） */
export function IssueIntelligenceSlot({ slug }: { slug: string }) {
  const { plan } = useIssueViewer();
  const isPlus = plan === "COMMENT" || plan === "FACTCHECK";
  return <DebateIntelligencePanel slug={slug} isPlus={isPlus} />;
}
