"use client";

import { useEffect, useState } from "react";
import { VOTE_CHOICES, type VoteChoiceId } from "@/lib/constants";
import { cn, formatNumber } from "@/lib/utils";
import type { Comment, FcVerdictId } from "@/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { EmojiBurst } from "./emoji-burst";

interface CommentCardProps {
  comment: Comment;
  canInteract?: boolean;
  canFactCheck?: boolean;
  fcLoading?: boolean;
  onLike?: (id: string) => void;
  onDislike?: (id: string) => void;
  onHelpful?: (id: string) => void;
  onFactCheck?: (id: string) => void;
  onReport?: (id: string) => void;
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
  onLike,
  onDislike,
  onHelpful,
  onFactCheck,
  onReport,
}: CommentCardProps) {
  const fc = comment.fcResult;
  const verdictStyle = fc ? VERDICT_STYLES[fc.verdict] : null;
  const [burst, setBurst] = useState<{ kind: "like" | "dislike"; key: number } | null>(null);

  const fireLike = () => {
    setBurst({ kind: "like", key: Date.now() });
    onLike?.(comment.id);
  };
  const fireDislike = () => {
    setBurst({ kind: "dislike", key: Date.now() });
    onDislike?.(comment.id);
  };

  return (
    <article className="border-b border-border py-6 last:border-b-0">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{comment.userName}</span>
        {comment.userBadge && <Badge variant="pro">{comment.userBadge}</Badge>}
        <Badge variant="stance">{stanceLabel(comment.stance)}派</Badge>
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
    </article>
  );
}
