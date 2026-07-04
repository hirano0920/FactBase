"use client";

import { useEffect, useState } from "react";
import { VOTE_CHOICES } from "@/lib/constants";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import type { VoteChoiceId } from "@/lib/constants";
import type { VoteLabels, VoteTally } from "@/types";
import { Button } from "@/components/ui/button";
import { VoteConfetti } from "@/components/issue/vote-confetti";

interface VotePanelProps {
  tally: VoteTally;
  userVote?: VoteChoiceId | null;
  canVote?: boolean;
  /** Radar争点用のカスタム選択肢文言（例: 説明すべき/問題ない/判断できない） */
  labels?: VoteLabels | null;
  onVote?: (choice: VoteChoiceId) => void;
  /** 投票確定直後だけtrueにして渡す。紙吹雪を出す合図。 */
  celebrate?: boolean;
}

const countKey = (id: VoteChoiceId) => (id === "for" ? "for" : id === "against" ? "against" : "undecided");

function leadingCallout(tally: VoteTally, labels?: VoteLabels | null) {
  const { for: f, against: a } = tally.percents;
  const diff = Math.abs(f - a);
  const label = (id: VoteChoiceId) =>
    labels?.[id] ?? VOTE_CHOICES.find((c) => c.id === id)?.label ?? id;

  if (tally.totalVotes === 0) return { emoji: "🤔", text: "まだ誰も投票していません" };
  if (diff < 3) return { emoji: "🤝", text: "互角の戦い！" };
  if (f > a) {
    return {
      emoji: diff > 25 ? "🔥" : "📊",
      text: `${label("for")}が優勢`,
      color: "text-for",
    };
  }
  return {
    emoji: diff > 25 ? "🔥" : "📊",
    text: `${label("against")}が優勢`,
    color: "text-against",
  };
}

export function VotePanel({
  tally,
  userVote,
  canVote = false,
  labels,
  onVote,
  celebrate = false,
}: VotePanelProps) {
  const [revealed, setRevealed] = useState(Boolean(userVote));
  // 投票が確定した瞬間（nullから何か選んだ瞬間）は自動で結果を開く
  useEffect(() => {
    if (userVote) setRevealed(true);
  }, [userVote]);

  const labelFor = (id: VoteChoiceId) =>
    labels?.[id] ?? VOTE_CHOICES.find((c) => c.id === id)?.label ?? id;

  const callout = leadingCallout(tally, labels);

  return (
    <div className="space-y-5">
      {!revealed ? (
        <div className="rounded-xl border border-dashed border-border-strong bg-surface-muted p-5 text-center">
          <p className="mb-3 text-sm text-ink-muted">
            投票するか、結果を見てから考えるか選べます
          </p>
          <Button variant="secondary" size="sm" onClick={() => setRevealed(true)}>
            👀 投票結果を見る
          </Button>
        </div>
      ) : (
        <div className="relative animate-pop-in">
          {celebrate && <VoteConfetti burstId={Date.now()} />}

          <p className={cn("mb-3 text-center text-base font-extrabold", callout.color ?? "text-ink")}>
            <span className="animate-flicker mr-1.5 inline-block">{callout.emoji}</span>
            {callout.text}
          </p>

          <div className="flex h-3 overflow-hidden rounded-full bg-surface-muted">
            {VOTE_CHOICES.map((choice) => (
              <div
                key={choice.id}
                className={cn(
                  "animate-grow-width transition-all duration-500",
                  choice.color === "for" && "bg-for",
                  choice.color === "against" && "bg-against",
                  choice.color === "neutral" && "bg-neutral/60",
                )}
                style={{ width: `${tally.percents[countKey(choice.id)]}%` }}
                title={`${choice.label} ${formatPercent(tally.percents[countKey(choice.id)])}`}
              />
            ))}
          </div>

          <p className="mt-3 text-center text-sm text-ink-muted">
            <span className="tabular-nums font-bold text-ink-secondary">
              {formatNumber(tally.totalVotes)}
            </span>
            {" 票 · "}
            <span className="tabular-nums font-bold text-ink-secondary">
              {formatNumber(tally.totalVoters)}
            </span>
            {" 人が投票"}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {VOTE_CHOICES.map((choice) => {
          const isSelected = userVote === choice.id;
          const variant =
            choice.id === "for"
              ? "vote-for"
              : choice.id === "against"
                ? "vote-against"
                : "vote-neutral";

          return (
            <Button
              key={choice.id}
              variant={variant}
              size="lg"
              fullWidth
              disabled={!canVote || userVote === choice.id}
              onClick={() => onVote?.(choice.id)}
              className={cn(
                "flex-col gap-1 py-4 transition-transform active:scale-95",
                isSelected && "ring-2 ring-offset-2 ring-offset-surface",
                choice.id === "for" && isSelected && "ring-for/40",
                choice.id === "against" && isSelected && "ring-against/40",
                choice.id === "undecided" && isSelected && "ring-neutral/40",
              )}
            >
              <span className="text-base font-bold">
                {isSelected && "✅ "}
                {labelFor(choice.id)}
              </span>
              {revealed && (
                <span className="tabular-nums text-sm opacity-80">
                  {formatPercent(tally.percents[countKey(choice.id)])}
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {!canVote && !userVote && (
        <p className="text-center text-xs text-ink-faint">
          投票するには
          <a href="/login" className="mx-1 underline">
            ログイン
          </a>
          が必要です
        </p>
      )}
    </div>
  );
}
