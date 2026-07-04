"use client";

import { useCallback, useState } from "react";
import { CommentCard } from "@/components/issue/comment-card";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/layout/page-container";
import { COMMENT_LIMITS, VOTE_CHOICES, type VoteChoiceId } from "@/lib/constants";
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
}

interface ApiErrorBody {
  error?: { message?: string };
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
}: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const [stance, setStance] = useState<VoteChoiceId>("for");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [fcPendingId, setFcPendingId] = useState<string | null>(null);
  const [fcRemaining, setFcRemaining] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/comments?issueId=${encodeURIComponent(issueId)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { comments: Comment[]; nextCursor: string | null };
    setComments(data.comments);
    setCursor(data.nextCursor);
  }, [issueId]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/comments?issueId=${encodeURIComponent(issueId)}&cursor=${encodeURIComponent(cursor)}`,
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
  }, [cursor, issueId, loadingMore]);

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
      setComments((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
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
      setComments((prev) =>
        prev.map((c) => (c.id === id ? { ...c, fcResult: data } : c)),
      );
    } catch {
      setActionError("通信に失敗しました");
    } finally {
      setFcPendingId(null);
    }
  }, []);

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

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <SectionTitle className="mb-0">議論</SectionTitle>
        <span className="text-sm text-ink-faint tabular-nums">{commentCount}件</span>
      </div>

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
            {isLoggedIn ? (
              <>
                コメントするには
                <a href="/pricing" className="mx-1 font-medium text-link">
                  500円プラン
                </a>
                が必要です
              </>
            ) : (
              <>
                コメントするには
                <a href="/login" className="mx-1 font-medium text-link">
                  ログイン
                </a>
                と
                <a href="/pricing" className="mx-1 font-medium text-link">
                  500円プラン
                </a>
                が必要です
              </>
            )}
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

      <div aria-busy={fcPendingId !== null}>
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
                onLike={handleLike}
                onDislike={handleDislike}
                onHelpful={handleHelpful}
                onFactCheck={handleFactCheck}
                onReport={handleReport}
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
