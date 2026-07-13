"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VotePanel } from "@/components/issue/vote-panel";
import { cn } from "@/lib/utils";
import type { VoteChoiceId } from "@/lib/constants";
import type { VoteTally } from "@/types";

interface VotePanelLiveProps {
  issueId: string;
  initialTally: VoteTally;
  initialUserVote: VoteChoiceId | null;
  isLoggedIn: boolean;
  labels?: import("@/types").VoteLabels | null;
  /** その争点で初めて投票した瞬間にだけ呼ばれる（投票直後のコメント導線用） */
  onFirstVote?: (choice: VoteChoiceId) => void;
}

/**
 * VotePanelのライブ版。
 * - 投票POST + 楽観的でない確定更新（レスポンスのtallyを反映）
 * - SSEでtallyをリアルタイム購読（EventSourceが切断時に自動再接続）
 * - 投票が確定した瞬間だけ celebrate=true にして紙吹雪を出す
 */
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
  // celebrateより長く保持する。初投票直後は結果バーの演出をしばらく見せてから
  // 「✅ 投票しました」の1行に折りたたみ、スレッドへ視線が流れるようにする。
  const [justVoted, setJustVoted] = useState(false);
  // 投票した瞬間だけ周囲を薄暗くして、決着バーの演出にスポットライトを当てる。
  // バーが伸びて衝突するまでの区間だけ有効にし、結果を読ませる段階では通常表示に戻す。
  const [dimActive, setDimActive] = useState(false);
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
          // 決着バーの演出（伸びる→ぶつかる→破片が散る）が最後まで見えるだけの時間を確保してから
          // 「✅ 投票しました」に折りたたむ。それまではスレッドの上で結果演出を見せ続ける。
          setJustVoted(true);
          setTimeout(() => mounted.current && setJustVoted(false), 2200);
          // バーが伸びて中央でぶつかるまで（CSS側は0.7〜1.25秒）だけ周囲を薄暗くする
          setDimActive(true);
          setTimeout(() => mounted.current && setDimActive(false), 1300);
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
      {/* 投票の瞬間、ページ全体（このカードも含めて）を一律に薄暗くする。
          決着バー自体は彩度の高い色と動きで暗さの上でも目立つため、あえてカードだけ
          明るく残す特別扱いはしない（シンプルに全体を暗く落とすだけで十分目立つ）。 */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none fixed inset-0 z-40 bg-ink/45 transition-opacity duration-200",
          dimActive ? "opacity-100" : "opacity-0",
        )}
      />
      <VotePanel
        tally={tally}
        userVote={userVote}
        canVote={isLoggedIn && !pending}
        isLoggedIn={isLoggedIn}
        labels={labels}
        onVote={handleVote}
        celebrate={celebrate}
        justVoted={justVoted}
      />
      {error && (
        <p role="alert" className="mt-3 text-center text-sm text-against">
          {error}
        </p>
      )}
    </div>
  );
}
