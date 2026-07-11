"use client";

import { useEffect, useState } from "react";
import { VOTE_CHOICES } from "@/lib/constants";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import type { VoteChoiceId } from "@/lib/constants";
import type { VoteLabels, VoteTally } from "@/types";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";

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
  // 投票を変更したい時だけ、一時的にフル表示（ボタン付き）に戻す
  const [changingVote, setChangingVote] = useState(false);
  // 投票が確定した瞬間（nullから何か選んだ瞬間）は自動で結果を開き、変更モードは閉じる
  useEffect(() => {
    if (userVote) setRevealed(true);
    setChangingVote(false);
  }, [userVote]);

  const labelFor = (id: VoteChoiceId) =>
    labels?.[id] ?? VOTE_CHOICES.find((c) => c.id === id)?.label ?? id;

  const callout = leadingCallout(tally, labels);

  // 投票済みなら、議論セクションの真上にコンパクトな結果バーだけを出す（フルUIは「変更する」を押した時だけ）
  if (userVote && !changingVote) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2.5">
        <span className="shrink-0 text-xs font-bold text-ink-secondary">
          ✅ {labelFor(userVote)}
        </span>
        <div className="flex h-2 flex-1 overflow-hidden rounded-sm bg-surface-muted">
          {VOTE_CHOICES.map((choice) => (
            <div
              key={choice.id}
              className={cn(
                choice.color === "for" && "bg-for",
                choice.color === "against" && "bg-against",
                choice.color === "neutral" && "bg-neutral/60",
              )}
              style={{ width: `${tally.percents[countKey(choice.id)]}%` }}
              title={`${labelFor(choice.id)} ${formatPercent(tally.percents[countKey(choice.id)])}`}
            />
          ))}
        </div>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">
          {formatNumber(tally.totalVoters)}人
        </span>
        <button
          type="button"
          onClick={() => setChangingVote(true)}
          className="shrink-0 text-xs font-medium text-link underline-offset-2 hover:underline"
        >
          変更する
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-5">
      {!revealed ? (
        <div className="rounded-[20px] border border-dashed border-border-strong bg-surface-muted p-3.5 text-center sm:p-5">
          <p className="mb-2.5 text-sm text-ink-muted sm:mb-3">
            投票するか、結果を見てから考えるか選べます
          </p>
          <Button variant="secondary" size="sm" onClick={() => setRevealed(true)}>
            👀 投票結果を見る
          </Button>
        </div>
      ) : (
        <div className="relative animate-pop-in">
          <p className={cn("mb-3 text-center text-base font-extrabold", callout.color ?? "text-ink")}>
            <span className="relative mr-1.5 inline-block">
              {celebrate && (
                <span
                  aria-hidden="true"
                  className="absolute -inset-1 animate-ring-pulse-once rounded-full border-2 border-current"
                />
              )}
              <span className="animate-flicker inline-block">{callout.emoji}</span>
            </span>
            {callout.text}
          </p>

          <div className="flex h-3 overflow-hidden rounded-sm bg-surface-muted">
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
            <CountUp value={tally.totalVotes} className="tabular-nums font-bold text-ink-secondary" />
            {" 票 · "}
            <CountUp value={tally.totalVoters} className="tabular-nums font-bold text-ink-secondary" />
            {" 人が投票"}
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
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
                "flex-col gap-0.5 px-1.5 py-3 transition-transform active:scale-95 sm:gap-1 sm:py-4",
                isSelected && "ring-2 ring-offset-2 ring-offset-surface",
                choice.id === "for" && isSelected && "ring-for/40",
                choice.id === "against" && isSelected && "ring-against/40",
                choice.id === "undecided" && isSelected && "ring-neutral/40",
              )}
            >
              <span className="line-clamp-2 text-sm font-bold sm:text-base">
                {isSelected && "✅ "}
                {labelFor(choice.id)}
              </span>
              {revealed && (
                <span className="text-xs tabular-nums opacity-80 sm:text-sm">
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
