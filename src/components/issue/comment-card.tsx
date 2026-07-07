"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { REPLY_LIMITS, VOTE_CHOICES, type VoteChoiceId } from "@/lib/constants";
import { cn, formatNumber } from "@/lib/utils";
import type { Comment, FcVerdictId } from "@/types";
import { UserDisplayName } from "@/components/user/display-name";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmojiBurst } from "./emoji-burst";

interface CommentCardProps {
  comment: Comment;
  canInteract?: boolean;
  canFactCheck?: boolean;
  fcLoading?: boolean;
  /** 返信一覧を描画する時、どの返信がFC実行中かを判定するために使う（自分自身のfcLoadingとは別枠） */
  fcPendingId?: string | null;
  onLike?: (id: string) => void;
  onDislike?: (id: string) => void;
  onHelpful?: (id: string) => void;
  onFactCheck?: (id: string) => void;
  onReport?: (id: string) => void;
  /** トップレベルコメントにのみ渡す。渡すと「返信する」ボタンが出る（返信自体には渡さない＝1階層のみ） */
  onReply?: (parentId: string, body: string) => Promise<string | null>;
  /** ネストされた返信として小さめ・インデント表示にする */
  isReply?: boolean;
}

function stanceLabel(stance: VoteChoiceId) {
  return VOTE_CHOICES.find((c) => c.id === stance)?.label ?? stance;
}

const VERDICT_STYLES: Record<FcVerdictId, { label: string; className: string }> = {
  true: { label: "一次情報で確認", className: "border-for/30 bg-for-muted text-for" },
  false: { label: "一次情報と矛盾", className: "border-against/30 bg-against-muted text-against" },
  reported: { label: "報道ベース・真偽未確認", className: "border-amber-500/30 bg-amber-50 text-amber-800" },
  disputed: { label: "当事者間で対立", className: "border-accent/30 bg-accent/5 text-accent" },
  unknown: { label: "一次情報では確認不可", className: "border-border bg-surface-muted text-ink-secondary" },
  opinion: { label: "意見・評価", className: "border-border bg-surface-muted text-ink-muted" },
};

const FC_LOADING_STAGES = [
  "🔍 法令データベースを検索しています…",
  "📚 国会会議録・公式資料と照合しています…",
  "🧐 一次情報と主張を突き合わせています…",
  "✍️ 判定を作成しています…",
];

/** FC実行中の段階表示（「色々なデータから正確に調べている」ことを可視化） */
function FcLoadingIndicator() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setStage((s) => Math.min(s + 1, FC_LOADING_STAGES.length - 1)),
      1800,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div
      className="mt-4 rounded-md border border-accent/20 bg-accent/5 px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
        </span>
        <p className="text-sm text-accent">{FC_LOADING_STAGES[stage]}</p>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-accent/10">
        <div
          className="h-full rounded-full bg-accent/50 transition-all duration-1000"
          style={{ width: `${((stage + 1) / FC_LOADING_STAGES.length) * 90}%` }}
        />
      </div>
    </div>
  );
}

export function CommentCard({
  comment,
  canInteract = false,
  canFactCheck = false,
  fcLoading = false,
  fcPendingId = null,
  onLike,
  onDislike,
  onHelpful,
  onFactCheck,
  onReport,
  onReply,
  isReply = false,
}: CommentCardProps) {
  const fc = comment.fcResult;
  const verdictStyle = fc ? VERDICT_STYLES[fc.verdict] : null;
  const [burst, setBurst] = useState<{ kind: "like" | "dislike"; key: number } | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const fireLike = () => {
    setBurst({ kind: "like", key: Date.now() });
    onLike?.(comment.id);
  };
  const fireDislike = () => {
    setBurst({ kind: "dislike", key: Date.now() });
    onDislike?.(comment.id);
  };

  const replyBodyLen = replyBody.trim().length;
  const replyLengthOk =
    replyBodyLen >= REPLY_LIMITS.minLength && replyBodyLen <= REPLY_LIMITS.maxLength;

  const submitReply = async () => {
    if (!onReply || replySubmitting || !replyLengthOk) return;
    setReplySubmitting(true);
    setReplyError(null);
    const error = await onReply(comment.id, replyBody);
    setReplySubmitting(false);
    if (error) {
      setReplyError(error);
      return;
    }
    setReplyBody("");
    setReplyOpen(false);
  };

  return (
    <article className={cn("border-b border-border py-6 last:border-b-0", isReply && "border-b-0 py-4")}>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={`/u/${comment.userId}`} className="no-underline hover:opacity-80">
          <UserDisplayName
            userId={comment.userId}
            name={comment.userName}
            plan={comment.userPlan}
            commentCount={comment.userCommentCount}
            totalLikes={comment.userTotalLikes}
            variant="thread"
            nameClassName="text-sm"
            stance={comment.stance}
          />
        </Link>
        {!isReply && <Badge variant="stance">{stanceLabel(comment.stance)}派</Badge>}
        <time className="text-xs text-ink-faint">{comment.createdAt.slice(0, 10)}</time>
      </header>

      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-secondary">
        {comment.body}
      </p>

      {fcLoading && !fc && <FcLoadingIndicator />}

      {fc && verdictStyle && (
        <div className={cn("mt-4 rounded-md border px-4 py-3", verdictStyle.className)}>
          <p className="text-xs font-semibold">
            ファクトチェック: {fc.label ?? verdictStyle.label}
          </p>
          <p className="mt-1 text-sm">{fc.reason}</p>
          {fc.sources.length > 0 && (
            <ul className="mt-2 space-y-1">
              {fc.sources.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-xs underline"
                  >
                    出典: {s.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] opacity-70">
            一次情報のみで判定 · 法的助言ではありません
          </p>
        </div>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          disabled={!canInteract}
          onClick={fireLike}
          className="relative tabular-nums"
          aria-label="共感する"
        >
          {burst?.kind === "like" && <EmojiBurst key={burst.key} emoji="👍" />}
          👍{" "}
          <span key={comment.likeCount} className="inline-block animate-pop-in">
            {formatNumber(comment.likeCount)}
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canInteract}
          onClick={fireDislike}
          className="relative tabular-nums"
          aria-label="共感しない"
        >
          {burst?.kind === "dislike" && <EmojiBurst key={burst.key} emoji="👎" />}
          👎{" "}
          <span key={comment.dislikeCount} className="inline-block animate-pop-in">
            {formatNumber(comment.dislikeCount)}
          </span>
        </Button>
        {onReply && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!canInteract}
            onClick={() => setReplyOpen((v) => !v)}
          >
            💬 返信する
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={!canInteract}
          onClick={() => onReport?.(comment.id)}
          className="text-ink-faint"
        >
          不適切なコメント
        </Button>
        {canFactCheck && !fc && (
          <Button
            variant="secondary"
            size="sm"
            disabled={fcLoading}
            onClick={() => onFactCheck?.(comment.id)}
            className="ml-auto border-accent/30 text-accent"
          >
            {fcLoading ? "確認中…" : "ファクトチェック"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={!canInteract}
          onClick={() => onHelpful?.(comment.id)}
          className={cn("tabular-nums", !canFactCheck || fc ? "ml-auto" : "")}
        >
          役に立った{" "}
          <span key={comment.helpfulCount} className="inline-block animate-pop-in">
            {formatNumber(comment.helpfulCount)}
          </span>
        </Button>
      </footer>

      {onReply && replyOpen && (
        <div className="mt-3 rounded-md border border-border bg-surface-muted p-3">
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={2}
            maxLength={REPLY_LIMITS.maxLength + 50}
            placeholder={`返信を${REPLY_LIMITS.minLength}字以上で入力`}
            className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
            autoFocus
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-xs text-ink-faint tabular-nums">
              {replyBodyLen} / {REPLY_LIMITS.maxLength}字
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReplyOpen(false)}>
                キャンセル
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!replyLengthOk || replySubmitting}
                onClick={submitReply}
              >
                {replySubmitting ? "送信中…" : "返信する"}
              </Button>
            </div>
          </div>
          {replyError && (
            <p role="alert" className="mt-1.5 text-xs text-against">
              {replyError}
            </p>
          )}
        </div>
      )}

      {!isReply && comment.replies.length > 0 && (
        <div className="mt-3 ml-3 space-y-1 border-l-2 border-border pl-4 sm:ml-6">
          {comment.replies.map((reply) => (
            <CommentCard
              key={reply.id}
              comment={reply}
              isReply
              canInteract={canInteract}
              canFactCheck={canFactCheck}
              fcLoading={fcPendingId === reply.id}
              onLike={onLike}
              onDislike={onDislike}
              onHelpful={onHelpful}
              onFactCheck={onFactCheck}
              onReport={onReport}
            />
          ))}
          {comment.replyCount > comment.replies.length && (
            <p className="pt-1 text-xs text-ink-faint">
              他{comment.replyCount - comment.replies.length}件の返信は表示されていません
            </p>
          )}
        </div>
      )}
    </article>
  );
}
