"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Fragment } from "react";
import { CommentCard } from "@/components/issue/comment-card";
import { Button } from "@/components/ui/button";
import { AdSlotGated } from "@/components/layout/ad-slot-gated";
import { SectionTitle } from "@/components/layout/page-container";
import {
  COMMENT_LIMITS,
  COMMENT_SORTS,
  type CommentSortId,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { VERDICT_STYLES } from "@/lib/fc-display";
import type { Comment, FactCheckResult } from "@/types";

interface NewsCommentSectionProps {
  issueId: string;
  issueSlug?: string;
  initialComments: Comment[];
  initialCursor: string | null;
  commentCount: number;
  canComment: boolean;
  canFactCheck: boolean;
  isLoggedIn: boolean;
}

const COMMENTS_PER_AD = 7;

interface ApiErrorBody {
  error?: { message?: string };
}

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

/**
 * News記事用の通常コメント欄。Debate用CommentSectionと異なり、
 * 投票済みかどうか・賛成/反対のスタンスに関係なく誰でも読める、フラットな一覧表示のみ。
 */
export function NewsCommentSection({
  issueId,
  issueSlug,
  initialComments,
  initialCursor,
  commentCount,
  canComment,
  canFactCheck,
  isLoggedIn,
}: NewsCommentSectionProps) {
  const searchParams = useSearchParams();
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<CommentSortId>("new");
  const [sortLoading, setSortLoading] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const [body, setBody] = useState(() => {
    const quote = searchParams.get("quote");
    return quote ? `> ${quote}\n\n` : "";
  });
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

  useEffect(() => {
    setComments(initialComments);
    setCursor(initialCursor);
    setSort("new");
  }, [issueId, initialComments, initialCursor]);

  useEffect(() => {
    if (!searchParams.get("quote") || !canComment) return;
    bodyRef.current?.focus();
    bodyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openComposer = useCallback(() => {
    setComposerOpen(true);
    requestAnimationFrame(() => {
      bodyRef.current?.focus();
      bodyRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

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
        body: JSON.stringify({ issueId, body }),
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
  }, [body, issueId, refresh, submitting]);

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
    } catch {
      setActionError("通信に失敗しました");
    } finally {
      setFcPendingId(null);
    }
  }, []);

  const patchComment = useCallback((updated: Comment) => {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
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

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <SectionTitle className="mb-0">コメント</SectionTitle>
        <span className="text-sm text-ink-faint tabular-nums">{commentCount}件</span>
      </div>

      {canComment && !composerOpen && (
        <button
          type="button"
          onClick={openComposer}
          className="mb-6 flex w-full items-center gap-2.5 rounded-full border border-border bg-surface-raised px-4 py-2.5 text-left text-sm text-ink-faint transition hover:border-border-strong hover:bg-surface-muted"
        >
          <span aria-hidden="true">💬</span>
          {commentCount === 0 ? "最初のコメントを書く" : "コメントする"}
        </button>
      )}

      {canComment && composerOpen ? (
        <div className="mb-6 rounded-[20px] border border-border bg-surface-raised p-5">
          <textarea
            id="comment-form"
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={COMMENT_LIMITS.maxLength + 100}
            placeholder={`${COMMENT_LIMITS.minLength}字以上で投稿してください`}
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

      <div className="mb-4 flex justify-end gap-1.5" role="radiogroup" aria-label="コメントの並び順">
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
                  showStance={false}
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
    </div>
  );
}
