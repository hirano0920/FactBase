"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CommentCard } from "@/components/issue/comment-card";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/layout/page-container";
import {
  COMMENT_LIMITS,
  COMMENT_SORTS,
  DEBATE_HIGHLIGHT_MIN_COMMENTS,
  VOTE_CHOICES,
  type CommentSortId,
  type VoteChoiceId,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Comment, FactCheckResult } from "@/types";

interface CommentSectionProps {
  issueId: string;
  initialComments: Comment[];
  initialCursor: string | null;
  commentCount: number;
  canComment: boolean;
  canFactCheck: boolean;
  isLoggedIn: boolean;
  /** 直前に初めて投票した選択肢。投票直後の「その理由を書く」導線に使う */
  promptStance?: VoteChoiceId | null;
}

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
  initialComments,
  initialCursor,
  commentCount,
  canComment,
  canFactCheck,
  isLoggedIn,
  promptStance,
}: CommentSectionProps) {
  const searchParams = useSearchParams();
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<CommentSortId>("new");
  const [sortLoading, setSortLoading] = useState(false);
  const [highlights, setHighlights] = useState<DebateHighlights | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const [stance, setStance] = useState<VoteChoiceId>("for");
  const [body, setBody] = useState(() => {
    const quote = searchParams.get("quote");
    return quote ? `> ${quote}\n\n` : "";
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

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

  // 投票直後: 「その理由をコメントで」導線を一度だけ出す
  useEffect(() => {
    if (promptStance) setVoteCta(promptStance);
  }, [promptStance]);

  const acceptVoteCta = useCallback(() => {
    if (!voteCta) return;
    setStance(voteCta);
    setVoteCta(null);
    bodyRef.current?.focus();
    bodyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [voteCta]);

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
    } catch {
      setFormError("通信に失敗しました。接続を確認してお試しください");
    } finally {
      setSubmitting(false);
    }
  }, [body, issueId, refresh, stance, submitting]);

  const bumpCount = useCallback(
    (id: string, field: "likeCount" | "dislikeCount" | "helpfulCount", value: number) => {
      setComments((prev) => updateCommentInTree(prev, id, (c) => ({ ...c, [field]: value })));
      setHighlights((prev) => {
        if (!prev) return prev;
        const patch = (c: Comment | null) =>
          c ? updateCommentInTree([c], id, (x) => ({ ...x, [field]: value }))[0] : c;
        return { for: patch(prev.for), against: patch(prev.against) };
      });
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

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <SectionTitle className="mb-0">議論</SectionTitle>
        <span className="text-sm text-ink-faint tabular-nums">{commentCount}件</span>
      </div>

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

      {canComment ? (
        <div className="mb-6 rounded-md border border-border bg-white p-4">
          <div className="mb-3 flex gap-2" role="radiogroup" aria-label="スタンス">
            {VOTE_CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={stance === choice.id}
                onClick={() => setStance(choice.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  stance === choice.id
                    ? "border-accent bg-accent text-white"
                    : "border-border text-ink-secondary hover:bg-surface-muted",
                )}
              >
                {choice.label}
              </button>
            ))}
          </div>
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
            <Button
              variant="primary"
              size="sm"
              disabled={!lengthOk || submitting}
              onClick={submit}
            >
              {submitting ? "投稿中…" : "投稿する"}
            </Button>
          </div>
          {formError && (
            <p role="alert" className="mt-2 text-sm text-against">
              {formError}
            </p>
          )}
          {formNotice && <p className="mt-2 text-sm text-for">{formNotice}</p>}
        </div>
      ) : (
        <div className="mb-6 rounded-md border border-border bg-surface-muted px-5 py-4 text-center">
          <p className="text-sm text-ink-secondary">
            コメントするには
            <a href="/login" className="mx-1 font-medium text-link">
              ログイン
            </a>
            してください（無料）
          </p>
        </div>
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

      <div className="mb-4 flex gap-1.5" role="radiogroup" aria-label="コメントの並び順">
        {COMMENT_SORTS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={sort === s.id}
            onClick={() => changeSort(s.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              sort === s.id
                ? "border-accent bg-accent text-white"
                : "border-border text-ink-secondary hover:bg-surface-muted",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div aria-busy={fcPendingId !== null || sortLoading}>
        {comments.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-faint">
            まだコメントはありません。最初の意見を投稿してみませんか。
          </p>
        ) : (
          comments.map((comment, i) => (
            <div
              key={comment.id}
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
    </div>
  );
}
