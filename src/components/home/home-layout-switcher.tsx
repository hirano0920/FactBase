"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HomeFeed } from "@/components/home/home-feed";
import { DeckProvider } from "@/components/home/card-deck/deck-context";
import { DeckTodayRail } from "@/components/home/card-deck/deck-today-rail";
import { DeckStage } from "@/components/home/card-deck/deck-stage";
import type { Issue } from "@/types";

type HomeMode = "feed" | "deck";

const MODE_STORAGE_KEY = "twosides:home-mode";
const DAY_MS = 24 * 60 * 60 * 1000;
/** 「今日のトップ」が閑散期でも空にならないための最低件数。割れば最新12件にフォールバックする */
const MIN_TODAY_ISSUES = 5;
const TODAY_FALLBACK_COUNT = 12;

function pickTodayIssues(allIssues: Issue[]): Issue[] {
  const now = Date.now();
  const today = allIssues.filter((i) => now - new Date(i.createdAt).getTime() < DAY_MS);
  return today.length >= MIN_TODAY_ISSUES ? today : allIssues.slice(0, TODAY_FALLBACK_COUNT);
}

interface HomeLayoutSwitcherProps {
  allIssues: Issue[];
  mostRead?: Issue;
  mostActive?: Issue;
  participants: number;
  leftRail: ReactNode;
  sidebar: ReactNode;
}

/**
 * ホーム画面の「フィード表示」(既存)と「カード表示」(PCカードデッキモード)を切り替える。
 * デフォルトはfeedのまま(既存ユーザーの体験を変えない)。カード表示はlocalStorageで
 * 好みを記憶し、次回訪問時も引き継ぐ。カードデッキ自体はデスクトップ(lg+)専用。
 */
export function HomeLayoutSwitcher({
  allIssues,
  mostRead,
  mostActive,
  participants,
  leftRail,
  sidebar,
}: HomeLayoutSwitcherProps) {
  const [mode, setMode] = useState<HomeMode>("feed");

  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (saved === "deck" || saved === "feed") setMode(saved);
  }, []);

  const changeMode = (next: HomeMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // 保存できなくても表示切り替え自体は成立する
    }
  };

  const deckIssues = useMemo(() => pickTodayIssues(allIssues), [allIssues]);

  const modeToggle = (
    <div
      className="hidden w-fit rounded-full border border-border bg-surface-muted p-1 text-xs font-bold lg:inline-flex"
      role="radiogroup"
      aria-label="表示モード"
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === "feed"}
        onClick={() => changeMode("feed")}
        className={cn(
          "rounded-full px-3.5 py-1.5 transition-colors",
          mode === "feed" ? "bg-ink text-surface" : "text-ink-muted hover:text-ink",
        )}
      >
        フィード表示
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "deck"}
        onClick={() => changeMode("deck")}
        className={cn(
          "rounded-full px-3.5 py-1.5 transition-colors",
          mode === "deck" ? "bg-ink text-surface" : "text-ink-muted hover:text-ink",
        )}
      >
        カード表示
      </button>
    </div>
  );

  if (mode === "deck") {
    return (
      <DeckProvider issues={deckIssues}>
        <div className="hidden xl:block">
          <DeckTodayRail />
        </div>
        <div className="min-w-0 space-y-6">
          <div className="flex justify-end">{modeToggle}</div>
          <DeckStage />
        </div>
        <div className="hidden lg:block">{sidebar}</div>
      </DeckProvider>
    );
  }

  return (
    <>
      <div className="hidden xl:block">{leftRail}</div>
      <div className="min-w-0 space-y-6">
        <div className="flex justify-end">{modeToggle}</div>
        <HomeFeed
          allIssues={allIssues}
          mostRead={mostRead}
          mostActive={mostActive}
          participants={participants}
        />
      </div>
      <div className="hidden lg:block">{sidebar}</div>
    </>
  );
}
