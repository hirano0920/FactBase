"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VotePanel, VoteResultEffect } from "@/components/issue/vote-panel";
import { cn } from "@/lib/utils";
import type { VoteChoiceId } from "@/lib/constants";
import type { VoteLabels, VoteTally } from "@/types";

interface VotePanelLiveProps {
  issueId: string;
  initialTally: VoteTally;
  initialUserVote: VoteChoiceId | null;
  isLoggedIn: boolean;
  labels?: VoteLabels | null;
  /** その争点で初めて投票した瞬間にだけ呼ばれる（投票直後のコメント導線用） */
  onFirstVote?: (choice: VoteChoiceId) => void;
}

type CelebrationPhase = "idle" | "active" | "closing";

const CELEBRATION_ACTIVE_MS = 2200;
const CELEBRATION_CLOSE_MS = 300;

/**
 * 初投票直後だけ出るポップアップ演出。
 * ページ全体を薄暗くした上に、決着バー演出（コールアウト→バー衝突→票数）だけを
 * 浮かせたカードとして中央に出す。閉じるときはポップアップとディマーを同時にフェードアウトさせ、
 * その後に議論欄へのスクロール（comment-section.tsx側）が続く。
 */
function VoteCelebrationModal({
  phase,
  tally,
  labels,
  celebrate,
}: {
  phase: CelebrationPhase;
  tally: VoteTally;
  labels?: VoteLabels | null;
  celebrate: boolean;
}) {
  if (phase === "idle" || typeof document === "undefined") return null;
  const visible = phase === "active";

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none fixed inset-0 z-40 bg-ink/50 transition-opacity duration-300",
          visible ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-5">
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "w-full max-w-sm rounded-[20px] border border-border bg-surface p-5 shadow-2xl transition-all duration-300 sm:p-6",
            visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0",
          )}
        >
          <VoteResultEffect tally={tally} labels={labels} celebrate={celebrate} />
        </div>
      </div>
    </>,
    document.body,
  );
}

export function VotePanelLive({
  issueId,
  initialTally,
  initialUserVote,
  isLoggedIn,
  labels,
  onFirstVote,
}: VotePanelLiveProps) {
  const [tally, setTally] = useState<VoteTally>(initialTally);
  const [userVote, setUserVote] = useState<VoteChoiceId | null>(initialUserVote);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  // ポップアップ演出の開閉フェーズ。active=フル表示、closing=フェードアウト中
  const [celebrationPhase, setCelebrationPhase] = useState<CelebrationPhase>("idle");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setTally(initialTally);
    setUserVote(initialUserVote);
    setError(null);
    const source = new EventSource(
      `/api/votes/stream?issueId=${encodeURIComponent(issueId)}`,
    );
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as VoteTally;
        if (mounted.current) setTally(next);
      } catch {
        // 不正なフレームは無視
      }
    };
    return () => {
      mounted.current = false;
      source.close();
    };
  }, [issueId, initialTally, initialUserVote]);

  const handleVote = useCallback(
    async (choice: VoteChoiceId) => {
      if (!isLoggedIn || pending) return;
      setPending(true);
      setError(null);
      try {
        const res = await fetch("/api/votes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ issueId, choice }),
        });
        const data = (await res.json()) as {
          tally?: VoteTally;
          error?: { message: string };
        };
        if (!res.ok || !data.tally) {
          setError(data.error?.message ?? "投票に失敗しました。もう一度お試しください");
          return;
        }
        const isFirstVote = userVote === null;
        setTally(data.tally);
        setUserVote(choice);
        if (isFirstVote) {
          setCelebrate(true);
          setTimeout(() => mounted.current && setCelebrate(false), 1000);
          // active（フル表示）→closing（フェードアウト）→idle（消滅）の順で進める。
          // comment-section.tsx側のスクロール遅延（2700ms）はこの合計と揃えてある。
          setCelebrationPhase("active");
          setTimeout(
            () => mounted.current && setCelebrationPhase("closing"),
            CELEBRATION_ACTIVE_MS,
          );
          setTimeout(
            () => mounted.current && setCelebrationPhase("idle"),
            CELEBRATION_ACTIVE_MS + CELEBRATION_CLOSE_MS,
          );
          onFirstVote?.(choice);
        }
      } catch {
        setError("通信に失敗しました。接続を確認してお試しください");
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [issueId, isLoggedIn, onFirstVote, pending, userVote],
  );

  return (
    <div aria-busy={pending}>
      <VoteCelebrationModal phase={celebrationPhase} tally={tally} labels={labels} celebrate={celebrate} />
      <VotePanel
        tally={tally}
        userVote={userVote}
        canVote={isLoggedIn && !pending}
        isLoggedIn={isLoggedIn}
        labels={labels}
        onVote={handleVote}
      />
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-against">
          {error}
        </p>
      )}
    </div>
  );
}
