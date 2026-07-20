"use client";

import { DeckCard } from "@/components/home/card-deck/deck-card";
import { useDeck } from "@/components/home/card-deck/deck-context";

export function DeckStage() {
  const { issues, index, current, queueCount, skip, readLater, openDetail } = useDeck();
  const remaining = Math.max(issues.length - index, 0);

  return (
    <div>
      <div className="mb-3.5 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink-muted">
          残り <b className="tabular-nums text-ink">{remaining}</b> 本
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">
          📚 あとで読む <span className="tabular-nums">{queueCount}</span> 件
        </span>
      </div>

      {current ? (
        <DeckCard issue={current} onSkip={skip} onRead={readLater} onOpen={openDetail} />
      ) : (
        <div className="rounded-[20px] border border-dashed border-border-strong px-6 py-16 text-center text-ink-muted">
          <p className="mb-2 text-3xl" aria-hidden="true">
            ☕
          </p>
          <p className="text-sm">今日分は以上です。おつかれさまでした。</p>
        </div>
      )}
    </div>
  );
}
