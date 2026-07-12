"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Fragment } from "react";
import { CommentCard } from "@/components/issue/comment-card";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { AdSlotGated } from "@/components/layout/ad-slot-gated";
import { SectionTitle } from "@/components/layout/page-container";
import {
  COMMENT_LIMITS,
  COMMENT_SORTS,
  DEBATE_HIGHLIGHT_MIN_COMMENTS,
  SITE,
  VOTE_CHOICES,
  type CommentSortId,
  type VoteChoiceId,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { VERDICT_STYLES } from "@/lib/fc-display";
import { RebuttalAssistButton } from "@/components/issue/rebuttal-assist";
import type { Comment, FactCheckResult, SplitComment, VoteTally } from "@/types";

interface CommentSectionProps {
  issueId: string;
  issueSlug?: string;
  initialComments: Comment[];
  initialCursor: string | null;
  commentCount: number;
  canComment: boolean;
  canFactCheck: boolean;
  canRebuttalAi?: boolean;
  userVote?: VoteChoiceId | null;
  isLoggedIn: boolean;
  /** 直前に初めて投票した選択肢。投票直後の「その理由を書く」導線に使う */
  promptStance?: VoteChoiceId | null;
  /** スプリットスレッドのVSバー・タブに使う投票tally（ページ読み込み時点のスナップショット） */
  voteTally: VoteTally;
}

/** コメントが多い争点で議論欄がだらだら長くなるのを避けつつ広告在庫を確保するため、この件数ごとに1枠挟む */
const COMMENTS_PER_AD = 7;

const VOTE_CTA_LABEL: Record<VoteChoiceId, string> = {
  for: "賛成",
  against: "反対",
  undecided: "わからない",
};

interface ApiErrorBody {
  error?: { message?: string };
}

interface DebateHighlights {
  for: Comment | null;
  against: Comment | null;
}

type SplitLayout = "split" | "single";
type SplitSide = "for" | "against";

interface SplitColumnState {
  comments: SplitComment[];
  cursor: string | null;
}

const OPPOSITE_STANCE: Record<VoteChoiceId, SplitSide | null> = {
  for: "against",
  against: "for",
  undecided: null,
};

/** 投稿前チェックはcommentIdを持たないため、保存済みコメントのFC結果と違いcheckedAtは無い */
type DraftFcDisplay = Omit<FactCheckResult, "checkedAt">;

/** トップレベルコメント配列の中から、そのコメント自身または1階層下の返信のidを探して更新する */
function updateCommentInTree(
  list: Comment[],
  id: string,
  updater: (c: Comment) => Comment,
): Comment[] {
  return list.map((c) => {
    if (c.id === id) return updater(c);
    if (c.replies.some((r) => r.id === id)) {
      return { ...c, replies: c.replies.map((r) => (r.id === id ? updater(r) : r)) };
    }
    return c;
  });
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as ApiErrorBody;
    return data.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function CommentSection({
  issueId,
  issueSlug,
  initialComments,
  initialCursor,
  commentCount,
  canComment,
  canFactCheck,
  canRebuttalAi = false,
  userVote = null,
  isLoggedIn,
  promptStance,
  voteTally,
}: CommentSectionProps) {
  const searchParams = useSearchParams();
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<CommentSortId>("new");
  const [sortLoading, setSortLoading] = useState(false);
  const [highlights, setHighlights] = useState<DebateHighlights | null>(null);
  const [layout, setLayout] = useState<SplitLayout>("split");
  const [splitFor, setSplitFor] = useState<SplitColumnState>({ comments: [], cursor: null });
  const [splitAgainst, setSplitAgainst] = useState<SplitColumnState>({ comments: [], cursor: null });
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitLoadingMore, setSplitLoadingMore] = useState<SplitSide | null>(null);
  const [mobileActiveSide, setMobileActiveSide] = useState<SplitSide>("for");
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // コメントは「投票した側」でしか書けない（自由に立場を選べると投票と主張がズレる）。
  // このコンポーネントに到達している時点でcanComment=trueならuserVoteは必ず確定している
  const stance: VoteChoiceId = userVote ?? "for";
  const [body, setBody] = useState(() => {
    const quote = searchParams.get("quote");
    return quote ? `> ${quote}\n\n` : "";
  });
  // 投稿フォームは既定で畳んでおく（縦に長くなりがちなページを短くする）。
  // 引用リンクからの遷移時だけは最初から開いた状態にする
  const [composerOpen, setComposerOpen] = useState(() => Boolean(searchParams.get("quote")) && canComment);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [draftFcChecking, setDraftFcChecking] = useState(false);
  const [draftFcResult, setDraftFcResult] = useState<DraftFcDisplay | null>(null);
  const [draftFcError, setDraftFcError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [fcPendingId, setFcPendingId] = useState<string | null>(null);
  const [fcRemaining, setFcRemaining] = useState<number | null>(null);
  const [voteCta, setVoteCta] = useState<VoteChoiceId | null>(null);

  // 親（IssueViewerProvider）から争点ごとのコメントが届いたら同期する
  useEffect(() => {
    setComments(initialComments);
    setCursor(initialCursor);
    setSort("new");
    setHighlights(null);
  }, [issueId, initialComments, initialCursor]);

  // 論点の引用リンクからの遷移時: フォームまでスクロールし、本文にフォーカスする
  useEffect(() => {
    if (!searchParams.get("quote") || !canComment) return;
    bodyRef.current?.focus();
    bodyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 畳んだフォームを開いて本文にフォーカスする（開いた直後はまだ未マウントなのでrAFで1フレーム待つ）
  const openComposer = useCallback(() => {
    setComposerOpen(true);
    requestAnimationFrame(() => {
      bodyRef.current?.focus();
      bodyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  // 投票直後: 「その理由をコメントで」導線を一度だけ出す
  useEffect(() => {
    if (promptStance) setVoteCta(promptStance);
  }, [promptStance]);

  // 投票直後: モバイルは反対側カラムがタブの裏に隠れて「aha moment」を逃すため、
  // 逆側カラム（越境評価トップ＝相手陣営が最も納得した意見）のタブへ自動で切り替える
  useEffect(() => {
    if (!promptStance) return;
    const opposite = OPPOSITE_STANCE[promptStance];
    if (opposite) setMobileActiveSide(opposite);
  }, [promptStance]);

  const acceptVoteCta = useCallback(() => {
    if (!voteCta) return;
    setVoteCta(null);
    openComposer();
  }, [voteCta, openComposer]);

  // 空カラムの「最初の一人になる」CTA。投票した側のカラムでしか表示しない（他側には投稿できないため）
  const startStanceFromColumn = useCallback(() => {
    openComposer();
  }, [openComposer]);

  const fetchSplitData = useCallback(async () => {
    const res = await fetch(`/api/comments/split?issueId=${encodeURIComponent(issueId)}`);
    if (!res.ok) return null;
    return (await res.json()) as {
      for: { comments: SplitComment[]; nextCursor: string | null };
      against: { comments: SplitComment[]; nextCursor: string | null };
    };
  }, [issueId]);

  const loadSplit = useCallback(async () => {
    const data = await fetchSplitData().catch(() => null);
    if (!data) return;
    setSplitFor({ comments: data.for.comments, cursor: data.for.nextCursor });
    setSplitAgainst({ comments: data.against.comments, cursor: data.against.nextCursor });
  }, [fetchSplitData]);

  // issueId変更時（初回描画含む）にスプリット表示用のデータを取得する
  useEffect(() => {
    let cancelled = false;
    setSplitLoading(true);
    void loadSplit().finally(() => {
      if (!cancelled) setSplitLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSplit]);

  const loadMoreSplit = useCallback(
    async (side: SplitSide) => {
      const state = side === "for" ? splitFor : splitAgainst;
      if (!state.cursor || splitLoadingMore) return;
      setSplitLoadingMore(side);
      try {
        const cursorParam = side === "for" ? "forCursor" : "againstCursor";
        const res = await fetch(
          `/api/comments/split?issueId=${encodeURIComponent(issueId)}&${cursorParam}=${encodeURIComponent(state.cursor)}`,
        );
        if (!res.ok) {
          setActionError(await readError(res, "コメントの読み込みに失敗しました"));
          return;
        }
        const data = (await res.json()) as {
          for: { comments: SplitComment[]; nextCursor: string | null };
          against: { comments: SplitComment[]; nextCursor: string | null };
        };
        const column = data[side];
        const setState = side === "for" ? setSplitFor : setSplitAgainst;
        setState((prev) => ({
          comments: [...prev.comments, ...column.comments],
          cursor: column.nextCursor,
        }));
      } catch {
        setActionError("通信に失敗しました。接続を確認してお試しください");
      } finally {
        setSplitLoadingMore(null);
      }
    },
    [issueId, splitFor, splitAgainst, splitLoadingMore],
  );

  // 賛成派・反対派の代表意見（対決表示）。初回描画を優先するため少し遅延して取得する
  useEffect(() => {
    if (commentCount < DEBATE_HIGHLIGHT_MIN_COMMENTS) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/comments/highlights?issueId=${encodeURIComponent(issueId)}`);
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as DebateHighlights;
          if (!cancelled) setHighlights(data);
        } catch {
          // 対決表示は無くても議論自体には支障ないので静かに諦める
        }
      })();
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [issueId, commentCount]);

  const fetchPage = useCallback(
    async (targetSort: CommentSortId) => {
      const res = await fetch(
        `/api/comments?issueId=${encodeURIComponent(issueId)}&sort=${targetSort}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as { comments: Comment[]; nextCursor: string | null };
    },
    [issueId],
  );

  const refresh = useCallback(async () => {
    const data = await fetchPage(sort);
    if (!data) return;
    setComments(data.comments);
    setCursor(data.nextCursor);
  }, [fetchPage, sort]);

  const changeSort = useCallback(
    async (next: CommentSortId) => {
      if (next === sort || sortLoading) return;
      setSortLoading(true);
      setSort(next);
      try {
        const data = await fetchPage(next);
        if (data) {
          setComments(data.comments);
          setCursor(data.nextCursor);
        }
      } finally {
        setSortLoading(false);
      }
    },
    [fetchPage, sort, sortLoading],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/comments?issueId=${encodeURIComponent(issueId)}&cursor=${encodeURIComponent(cursor)}&sort=${sort}`,
      );
      if (!res.ok) {
        setActionError(await readError(res, "コメントの読み込みに失敗しました"));
        return;
      }
      const data = (await res.json()) as { comments: Comment[]; nextCursor: string | null };
      setComments((prev) => [...prev, ...data.comments]);
      setCursor(data.nextCursor);
    } catch {
      setActionError("通信に失敗しました。接続を確認してお試しください");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, issueId, loadingMore, sort]);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    setFormNotice(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, stance, body }),
      });
      if (!res.ok) {
        setFormError(await readError(res, "投稿に失敗しました。もう一度お試しください"));
        return;
      }
      setBody("");
      setFormNotice("投稿しました");
      await refresh();
      await loadSplit();
    } catch {
      setFormError("通信に失敗しました。接続を確認してお試しください");
    } finally {
      setSubmitting(false);
    }
  }, [body, issueId, loadSplit, refresh, stance, submitting]);

  // 本文を編集したら投稿前チェック結果は無効（その本文に対する判定ではなくなるため）
  useEffect(() => {
    setDraftFcResult(null);
    setDraftFcError(null);
  }, [body]);

  const runDraftFactCheck = useCallback(async () => {
    if (draftFcChecking) return;
    setDraftFcChecking(true);
    setDraftFcError(null);
    try {
      const res = await fetch("/api/comments/factcheck-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, body }),
      });
      if (!res.ok) {
        setDraftFcError(await readError(res, "ファクトチェックに失敗しました"));
        return;
      }
      const data = (await res.json()) as DraftFcDisplay & { remaining: number };
      setDraftFcResult(data);
      setFcRemaining(data.remaining);
    } catch {
      setDraftFcError("通信に失敗しました");
    } finally {
      setDraftFcChecking(false);
    }
  }, [body, draftFcChecking, issueId]);

  const bumpCount = useCallback(
    (id: string, field: "likeCount" | "dislikeCount" | "helpfulCount", value: number) => {
      setComments((prev) => updateCommentInTree(prev, id, (c) => ({ ...c, [field]: value })));
      setHighlights((prev) => {
        if (!prev) return prev;
        const patch = (c: Comment | null) =>
          c ? updateCommentInTree([c], id, (x) => ({ ...x, [field]: value }))[0] : c;
        return { for: patch(prev.for), against: patch(prev.against) };
      });
      setSplitFor((prev) => ({
        ...prev,
        comments: prev.comments.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
      }));
      setSplitAgainst((prev) => ({
        ...prev,
        comments: prev.comments.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
      }));
    },
    [],
  );

  const handleLike = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        const res = await fetch(`/api/comments/${id}/like`, { method: "POST" });
        if (!res.ok) return setActionError(await readError(res, "操作に失敗しました"));
        const data = (await res.json()) as { likeCount: number };
        bumpCount(id, "likeCount", data.likeCount);
      } catch {
        setActionError("通信に失敗しました");
      }
    },
    [bumpCount],
  );

  const handleDislike = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        const res = await fetch(`/api/comments/${id}/dislike`, { method: "POST" });
        if (!res.ok) return setActionError(await readError(res, "操作に失敗しました"));
        const data = (await res.json()) as { dislikeCount: number };
        bumpCount(id, "dislikeCount", data.dislikeCount);
      } catch {
        setActionError("通信に失敗しました");
      }
    },
    [bumpCount],
  );

  const handleHelpful = useCallback(
    async (id: string) => {
      setActionError(null);
      try {
        const res = await fetch(`/api/comments/${id}/helpful`, { method: "POST" });
        if (!res.ok) return setActionError(await readError(res, "操作に失敗しました"));
        const data = (await res.json()) as { helpfulCount: number };
        bumpCount(id, "helpfulCount", data.helpfulCount);
      } catch {
        setActionError("通信に失敗しました");
      }
    },
    [bumpCount],
  );

  const handleFactCheck = useCallback(async (id: string) => {
    setActionError(null);
    setFcPendingId(id);
    try {
      const res = await fetch(`/api/comments/${id}/factcheck`, { method: "POST" });
      if (!res.ok) {
        setActionError(await readError(res, "ファクトチェックに失敗しました"));
        return;
      }
      const data = (await res.json()) as FactCheckResult & { remaining: number };
      setFcRemaining(data.remaining);
      setComments((prev) => updateCommentInTree(prev, id, (c) => ({ ...c, fcResult: data })));
      setHighlights((prev) => {
        if (!prev) return prev;
        const patch = (c: Comment | null) =>
          c ? updateCommentInTree([c], id, (x) => ({ ...x, fcResult: data }))[0] : c;
        return { for: patch(prev.for), against: patch(prev.against) };
      });
      setSplitFor((prev) => ({
        ...prev,
        comments: prev.comments.map((c) => (c.id === id ? { ...c, fcResult: data } : c)),
      }));
      setSplitAgainst((prev) => ({
        ...prev,
        comments: prev.comments.map((c) => (c.id === id ? { ...c, fcResult: data } : c)),
      }));
    } catch {
      setActionError("通信に失敗しました");
    } finally {
      setFcPendingId(null);
    }
  }, []);

  const patchComment = useCallback((updated: Comment) => {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setHighlights((prev) => {
      if (!prev) return prev;
      const patch = (c: Comment | null) => (c && c.id === updated.id ? updated : c);
      return { for: patch(prev.for), against: patch(prev.against) };
    });
    // updatedはcrossHelpfulを持たない通常のCommentなので、既存のcrossHelpful値を保って合成する
    setSplitFor((prev) => ({
      ...prev,
      comments: prev.comments.map((c) => (c.id === updated.id ? { ...updated, crossHelpful: c.crossHelpful } : c)),
    }));
    setSplitAgainst((prev) => ({
      ...prev,
      comments: prev.comments.map((c) => (c.id === updated.id ? { ...updated, crossHelpful: c.crossHelpful } : c)),
    }));
  }, []);

  const handleReply = useCallback(
    async (parentId: string, body: string): Promise<string | null> => {
      setActionError(null);
      try {
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueId, body, parentId }),
        });
        if (!res.ok) return readError(res, "返信に失敗しました");

        // 返信投稿直後にその親コメント（返信一覧・件数込み）だけ最新化する
        const freshRes = await fetch(`/api/comments/${parentId}`);
        if (freshRes.ok) patchComment((await freshRes.json()) as Comment);
        return null;
      } catch {
        return "通信に失敗しました。接続を確認してお試しください";
      }
    },
    [issueId, patchComment],
  );

  const handleReport = useCallback(async (id: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/comments/${id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setActionError(await readError(res, "通報に失敗しました"));
        return;
      }
      setActionError(null);
      setFormNotice(
        "通報を受け付けました。複数の通報が集まるとAIが確認し、判断が難しい場合は人間が確認します",
      );
    } catch {
      setActionError("通信に失敗しました");
    }
  }, []);

  const bodyLength = body.trim().length;
  const lengthOk =
    bodyLength >= COMMENT_LIMITS.minLength && bodyLength <= COMMENT_LIMITS.maxLength;

  const hasHighlights = Boolean(highlights?.for || highlights?.against);
  // 投票直後: 逆側カラムの1位（越境評価スコア最上位＝相手陣営が最も納得した意見）を強調する
  const highlightSide = promptStance ? OPPOSITE_STANCE[promptStance] : null;

  // VSバー: 賛成/反対/わからないの実際の投票比率のまま3分割する（正規化しない＝過剰主張しない）
  const forPct = voteTally.percents.for;
  const againstPct = voteTally.percents.against;
  const undecidedPct = voteTally.percents.undecided;
  const hasVotes = voteTally.totalVotes > 0;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionTitle className="mb-0 bg-gradient-to-r from-ink to-accent bg-clip-text text-transparent">
            議論
          </SectionTitle>
        </div>
        <span className="text-sm text-ink-faint tabular-nums">{commentCount}件</span>
      </div>
      <p className="mb-5 text-xs text-ink-faint">
        <span className="bg-gradient-to-r from-accent to-hot bg-clip-text font-semibold text-transparent">
          相手陣営からも支持された意見
        </span>
        ほど上に表示されます。声の大きさではなく、納得感で並び替える{SITE.name}だけの仕組みです。
      </p>

      {voteCta && canComment && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
          <p className="text-sm text-ink-secondary">
            「<span className="font-semibold text-accent">{VOTE_CTA_LABEL[voteCta]}</span>
            」に投票しました。その理由を共有しませんか？
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="primary" size="sm" onClick={acceptVoteCta}>
              理由を書く
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setVoteCta(null)}>
              あとで
            </Button>
          </div>
        </div>
      )}

      {canComment && !composerOpen && (
        <button
          type="button"
          onClick={openComposer}
          className="mb-6 flex w-full items-center gap-2.5 rounded-full border border-border bg-surface-raised px-4 py-2.5 text-left text-sm text-ink-faint transition hover:border-border-strong hover:bg-surface-muted"
        >
          <span aria-hidden="true">💬</span>
          {commentCount === 0 ? "最初の意見を書く" : "あなたの意見を書く"}
        </button>
      )}

      {canComment && composerOpen ? (
        <div className="mb-6 rounded-[20px] border border-border bg-surface-raised p-5">
          {/* 立場は選ばせない。投票した側としてしかコメントできない（主張と投票がズレるのを防ぐ） */}
          <p className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent bg-accent px-3.5 py-1.5 text-sm font-medium text-white">
            {VOTE_CHOICES.find((c) => c.id === stance)?.label ?? stance}として投稿
          </p>
          <textarea
            id="comment-form"
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={COMMENT_LIMITS.maxLength + 100}
            placeholder={`根拠を添えて${COMMENT_LIMITS.minLength}字以上で投稿してください`}
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-[15px] leading-relaxed text-ink outline-none focus:border-accent"
            aria-label="コメント本文"
          />
          <div className="mt-2 flex items-center justify-between">
            <span
              className={cn(
                "text-xs tabular-nums",
                lengthOk ? "text-ink-faint" : "text-against",
              )}
            >
              {bodyLength} / {COMMENT_LIMITS.maxLength}字（{COMMENT_LIMITS.minLength}字以上）
            </span>
            <div className="flex gap-2">
              {canFactCheck && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!lengthOk || draftFcChecking}
                  onClick={runDraftFactCheck}
                >
                  {draftFcChecking ? "確認中…" : "投稿前にファクトチェック"}
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                disabled={!lengthOk || submitting}
                onClick={submit}
              >
                {submitting ? "投稿中…" : "投稿する"}
              </Button>
            </div>
          </div>
          {draftFcError && (
            <p role="alert" className="mt-2 text-sm text-against">
              {draftFcError}
            </p>
          )}
          {draftFcResult && (
            <div
              className={cn(
                "mt-2 rounded-md border px-3 py-2",
                VERDICT_STYLES[draftFcResult.verdict].className,
              )}
            >
              <p className="text-xs font-semibold">
                投稿前チェック: {draftFcResult.label ?? VERDICT_STYLES[draftFcResult.verdict].label}
                {draftFcResult.verdict !== "true" && "（投稿はブロックされません）"}
              </p>
              <p className="mt-1 text-sm">{draftFcResult.reason}</p>
            </div>
          )}
          {formError && (
            <p role="alert" className="mt-2 text-sm text-against">
              {formError}
            </p>
          )}
          {formNotice && <p className="mt-2 text-sm text-for">{formNotice}</p>}
        </div>
      ) : (
        !canComment && (
          <div className="mb-6 rounded-md border border-border bg-surface-muted px-5 py-4 text-center">
            <p className="text-sm text-ink-secondary">
              コメントするには
              <a href="/login" className="mx-1 font-medium text-link">
                ログイン
              </a>
              してください（無料）
            </p>
          </div>
        )
      )}

      {actionError && (
        <p role="alert" className="mb-4 text-sm text-against">
          {actionError}
        </p>
      )}

      {fcRemaining !== null && (
        <p className="mb-4 text-right text-xs text-ink-faint tabular-nums">
          本日のファクトチェック残り {fcRemaining} 回
        </p>
      )}

      {/* 未ログインは賛成・反対それぞれ上位1件だけ見せる形に固定する（ぼかしプレビュー）。
          一覧表示・並び替えは投票済みユーザー向けの機能なので出さない */}
      {isLoggedIn && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5" role="radiogroup" aria-label="表示形式">
            {(
              [
                { id: "split" as const, label: "賛成・反対で見る" },
                { id: "single" as const, label: "一覧で見る" },
              ]
            ).map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={layout === l.id}
                onClick={() => setLayout(l.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition",
                  layout === l.id
                    ? "border-accent bg-accent text-white"
                    : "border-border text-ink-secondary hover:bg-surface-muted",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>

          {layout === "single" && (
            <div className="flex gap-1.5" role="radiogroup" aria-label="コメントの並び順">
              {COMMENT_SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={sort === s.id}
                  onClick={() => changeSort(s.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    sort === s.id
                      ? "border-accent bg-accent text-white"
                      : "border-border text-ink-secondary hover:bg-surface-muted",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!isLoggedIn || layout === "split" ? (
        <div aria-busy={splitLoading}>
          {/* VSバー(デスクトップ): 実際の投票比率のまま3分割。正規化して埋めない＝過剰主張しない */}
          <div className="mb-5 hidden sm:block">
            <div className="mb-1.5 flex items-center justify-between text-xs font-bold">
              <span className="text-for">
                賛成 <CountUp value={forPct} format={(n) => `${n}%`} />
              </span>
              <span className="text-ink-faint">
                わからない <CountUp value={undecidedPct} format={(n) => `${n}%`} />
              </span>
              <span className="text-against">
                反対 <CountUp value={againstPct} format={(n) => `${n}%`} />
              </span>
            </div>
            <div className="relative flex h-2.5 overflow-hidden rounded-full border border-border bg-surface-muted">
              {hasVotes && (
                <>
                  <div className="bg-for transition-[width] duration-500 ease-out" style={{ width: `${forPct}%` }} />
                  <div
                    className="bg-ink-faint/30 transition-[width] duration-500 ease-out"
                    style={{ width: `${undecidedPct}%` }}
                  />
                  <div
                    className="bg-against transition-[width] duration-500 ease-out"
                    style={{ width: `${againstPct}%` }}
                  />
                  {/* 賛成/反対がぶつかる境界の小さな鼓動。「二陣営が対峙している」ことの象徴 */}
                  <span
                    aria-hidden="true"
                    className="animate-pulse-hot absolute top-1/2 h-2.5 w-2.5 rounded-full bg-hot shadow-[0_0_0_2px_var(--color-surface)] transition-[left] duration-500 ease-out"
                    style={{ left: `${forPct + undecidedPct}%`, transform: "translate(-50%, -50%)" }}
                  />
                </>
              )}
            </div>
          </div>

          {/* スコアボード風タブ(モバイル): 縦積みで対決感が消えないよう、常に片側だけを全幅表示する */}
          <div
            className="mb-5 flex overflow-hidden rounded-full border border-border sm:hidden"
            role="tablist"
            aria-label="賛成派・反対派の切り替え"
          >
            {(["for", "against"] as const).map((side) => (
              <button
                key={side}
                type="button"
                role="tab"
                aria-selected={mobileActiveSide === side}
                onClick={() => setMobileActiveSide(side)}
                className={cn(
                  "flex-1 py-2 text-center text-xs font-bold transition",
                  mobileActiveSide === side
                    ? side === "for"
                      ? "bg-for text-white"
                      : "bg-against text-white"
                    : "bg-surface text-ink-secondary",
                )}
              >
                {side === "for" ? (
                  <>
                    賛成 <CountUp value={forPct} format={(n) => `${n}%`} />
                  </>
                ) : (
                  <>
                    反対 <CountUp value={againstPct} format={(n) => `${n}%`} />
                  </>
                )}
              </button>
            ))}
          </div>

          <div className="relative">
            <div className="grid gap-5 sm:grid-cols-2">
              {(["for", "against"] as const).map((side) => {
                const state = side === "for" ? splitFor : splitAgainst;
                const label = side === "for" ? "賛成" : "反対";
                const oppositeLabel = side === "for" ? "反対" : "賛成";
                return (
                  <div key={side} className={cn(mobileActiveSide !== side && "hidden", "sm:block")}>
                    <div
                      className={cn(
                        "mb-2.5 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide",
                        side === "for" ? "bg-for-muted text-for" : "bg-against-muted text-against",
                      )}
                    >
                      <span>{label}派</span>
                      <span className="ml-auto font-normal opacity-70">{state.comments.length}件</span>
                    </div>
                    {state.comments.length === 0 ? (
                      <div className="rounded-[20px] border border-dashed border-border-strong px-4 py-8 text-center">
                        <p className="mb-3 text-sm text-ink-faint">
                          {splitLoading ? "読み込み中…" : `まだ${label}派の意見はありません。`}
                        </p>
                        {!splitLoading && canComment && side === userVote && (
                          <Button variant="secondary" size="sm" onClick={startStanceFromColumn}>
                            最初の一人になる👉
                          </Button>
                        )}
                      </div>
                    ) : !isLoggedIn ? (
                      // 未ログインは各側1件だけ素で見せ、その先はぼかして「ログインして続きを見る」に誘導する
                      <>
                        <CommentCard comment={state.comments[0]} canInteract={false} />
                        {state.comments.length > 1 && (
                          <div className="relative mt-2 overflow-hidden rounded-[20px]">
                            <div
                              aria-hidden="true"
                              className="pointer-events-none select-none space-y-2 blur-[3px]"
                            >
                              {state.comments.slice(1, 3).map((c) => (
                                <CommentCard key={c.id} comment={c} canInteract={false} />
                              ))}
                            </div>
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-b from-surface/30 via-surface/85 to-surface px-4 text-center">
                              <p className="text-sm font-bold text-ink">続きはログインして見る</p>
                              <a
                                href="/login"
                                className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-white no-underline hover:bg-accent-hover"
                              >
                                ログイン（無料）
                              </a>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      state.comments.map((comment, i) => {
                        const isTopOpposing = i === 0 && highlightSide === side && !comment.isAiSteelman;
                        const showCrossBadge = i === 0 && comment.crossHelpful > 0 && !comment.isAiSteelman;
                        const showAdAfter =
                          (i + 1) % COMMENTS_PER_AD === 0 && i !== state.comments.length - 1;
                        return (
                          <Fragment key={comment.id}>
                          <div
                            className={cn(
                              "animate-fade-slide-up",
                              isTopOpposing && "rounded-2xl ring-1 ring-accent/50",
                            )}
                            style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
                          >
                            {comment.isAiSteelman ? (
                              <p className="px-2 pt-2 text-xs font-bold text-ink-faint">
                                🤖 AIによる論点提示（まだ人間の投稿がないため、記事の材料だけを根拠に代弁しています）
                              </p>
                            ) : (
                              isTopOpposing && (
                                <p className="px-2 pt-2 text-xs font-bold text-accent">
                                  👀 最も説得力のある{label}派の意見
                                </p>
                              )
                            )}
                            {showCrossBadge && (
                              <div className="mx-2 mt-2 inline-flex items-center gap-1 rounded-full border border-transparent bg-gradient-to-r from-accent to-hot px-2.5 py-1 text-[11px] font-semibold text-white shadow-[0_2px_10px_rgb(79_70_229_/_0.25)]">
                                🔀 越境評価 no.1・{oppositeLabel}派の{comment.crossHelpful}人も支持
                              </div>
                            )}
                            <CommentCard
                              comment={comment}
                              canInteract={!comment.isAiSteelman && isLoggedIn}
                              canFactCheck={!comment.isAiSteelman && canFactCheck && !comment.fcResult}
                              fcLoading={fcPendingId === comment.id}
                              fcPendingId={fcPendingId}
                              onLike={handleLike}
                              onDislike={handleDislike}
                              onHelpful={handleHelpful}
                              onFactCheck={handleFactCheck}
                              onReport={comment.isAiSteelman ? undefined : handleReport}
                              onReply={!comment.isAiSteelman && canComment ? handleReply : undefined}
                            />
                            {canRebuttalAi &&
                              issueSlug &&
                              userVote &&
                              comment.stance !== userVote &&
                              !comment.isAiSteelman && (
                                <div className="px-2 pb-2">
                                  <RebuttalAssistButton slug={issueSlug} commentId={comment.id} />
                                </div>
                              )}
                            {comment.isAiSteelman && canComment && side === userVote && (
                              <div className="mt-3 text-center">
                                <Button variant="secondary" size="sm" onClick={startStanceFromColumn}>
                                  最初の一人になる👉
                                </Button>
                              </div>
                            )}
                          </div>
                          {showAdAfter && <AdSlotGated slug={issueSlug} className="my-4" />}
                          </Fragment>
                        );
                      })
                    )}
                    {state.cursor && (
                      <div className="mt-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={splitLoadingMore === side}
                          onClick={() => loadMoreSplit(side)}
                        >
                          {splitLoadingMore === side ? "読み込み中…" : "さらに読み込む"}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 中央の対戦線+VSバッジ(デスクトップのみ)。装飾なのでクリックは透過させる */}
            <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-border sm:block" />
            <div className="pointer-events-none absolute left-1/2 top-7 hidden h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-transparent bg-gradient-to-br from-accent to-hot text-[11px] font-bold text-white shadow-[0_2px_12px_rgb(79_70_229_/_0.3)] sm:flex">
              VS
            </div>
          </div>
        </div>
      ) : (
        <>
          {hasHighlights && (
            <div className="mb-6">
              <p className="mb-2.5 text-xs font-extrabold tracking-wide text-ink-faint">
                🥊 賛成派・反対派の代表意見
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["for", "against"] as const).map((side) => {
                  const highlight = highlights?.[side];
                  if (!highlight) return null;
                  return (
                    <div
                      key={side}
                      className={cn(
                        "overflow-hidden rounded-xl border",
                        side === "for" ? "border-for/30 bg-for-muted/30" : "border-against/30 bg-against-muted/30",
                      )}
                    >
                      <p
                        className={cn(
                          "px-4 pt-3 text-xs font-bold",
                          side === "for" ? "text-for" : "text-against",
                        )}
                      >
                        {side === "for" ? "賛成派の代表意見" : "反対派の代表意見"}
                      </p>
                      <div className="px-2">
                        <CommentCard
                          comment={highlight}
                          canInteract={isLoggedIn}
                          canFactCheck={canFactCheck && !highlight.fcResult}
                          fcLoading={fcPendingId === highlight.id}
                          fcPendingId={fcPendingId}
                          onLike={handleLike}
                          onDislike={handleDislike}
                          onHelpful={handleHelpful}
                          onFactCheck={handleFactCheck}
                          onReport={handleReport}
                          onReply={canComment ? handleReply : undefined}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div aria-busy={fcPendingId !== null || sortLoading}>
            {comments.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-faint">
                まだコメントはありません。最初の意見を投稿してみませんか。
              </p>
            ) : (
              comments.map((comment, i) => (
                <Fragment key={comment.id}>
                  <div
                    className="animate-fade-slide-up"
                    style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
                  >
                    <CommentCard
                      comment={comment}
                      canInteract={isLoggedIn}
                      canFactCheck={canFactCheck && !comment.fcResult}
                      fcLoading={fcPendingId === comment.id}
                      fcPendingId={fcPendingId}
                      onLike={handleLike}
                      onDislike={handleDislike}
                      onHelpful={handleHelpful}
                      onFactCheck={handleFactCheck}
                      onReport={handleReport}
                      onReply={canComment ? handleReply : undefined}
                    />
                  </div>
                  {(i + 1) % COMMENTS_PER_AD === 0 && i !== comments.length - 1 && (
                    <AdSlotGated slug={issueSlug} className="my-4" />
                  )}
                </Fragment>
              ))
            )}
          </div>

          {cursor && (
            <div className="mt-4 text-center">
              <Button variant="ghost" size="sm" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? "読み込み中…" : "さらに読み込む"}
              </Button>
            </div>
          )}

          {!isLoggedIn && commentCount > comments.length && (
            <div className="mt-4 rounded-xl border border-border bg-surface-muted px-5 py-4 text-center">
              <p className="text-sm text-ink-secondary">
                残り{commentCount - comments.length}件のコメントを見るには
                <a href="/login" className="mx-1 font-semibold text-link">
                  ログイン
                </a>
                してください（無料）
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
