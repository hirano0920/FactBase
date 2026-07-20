"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { Issue } from "@/types";

interface DeckContextValue {
  issues: Issue[];
  index: number;
  current: Issue | null;
  queueCount: number;
  seenIds: Set<string>;
  jumpTo: (i: number) => void;
  skip: () => void;
  readLater: () => void;
  openDetail: () => void;
}

const DeckContext = createContext<DeckContextValue | null>(null);

export function useDeck(): DeckContextValue {
  const ctx = useContext(DeckContext);
  if (!ctx) throw new Error("DeckProvider required");
  return ctx;
}

const SEEN_KEY_PREFIX = "twosides:deck:seen:";

/** 日付ごとにキーを分ける＝日をまたぐとスキップ済み一覧がリセットされる */
function todayStorageKey(): string {
  return SEEN_KEY_PREFIX + new Date().toISOString().slice(0, 10);
}

interface DeckProviderProps {
  issues: Issue[];
  children: ReactNode;
}

/**
 * PCカードデッキモードの共有状態。左レール(DeckTodayRail)と中央カード(DeckStage)が
 * 同じissues/indexを参照する必要があるため、issue-viewer-contextと同じ「単一Providerに
 * まとめてトップレベルで挟む」パターンを踏襲する。
 */
export function DeckProvider({ issues, children }: DeckProviderProps) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(todayStorageKey());
      if (raw) setSeenIds(new Set(JSON.parse(raw) as string[]));
    } catch {
      // プライベートモード等でlocalStorageが使えない場合は空状態のまま続行する
    }
  }, []);

  const markSeen = useCallback((id: string) => {
    setSeenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try {
        window.localStorage.setItem(todayStorageKey(), JSON.stringify([...next]));
      } catch {
        // 保存に失敗しても表示上のセッション内状態は維持されるので無視する
      }
      return next;
    });
  }, []);

  const current = issues[index] ?? null;

  const jumpTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= issues.length) return;
      setIndex(i);
    },
    [issues.length],
  );

  const skip = useCallback(() => {
    if (!current) return;
    markSeen(current.id);
    setIndex((i) => i + 1);
  }, [current, markSeen]);

  const readLater = useCallback(() => {
    if (!current) return;
    markSeen(current.id);
    setQueueCount((n) => n + 1);
    // ブックマークAPIを流用: スワイプ右＝ブックマークに追加、という以外に新しい仕組みは作らない
    fetch(`/api/issues/${encodeURIComponent(current.slug)}/bookmark`, { method: "POST" }).catch(() => {});
    setIndex((i) => i + 1);
  }, [current, markSeen]);

  const openDetail = useCallback(() => {
    if (!current) return;
    router.push(`/issues/${current.slug}`);
  }, [current, router]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target;
      if (target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.key === "j" || e.key === "J" || e.key === "ArrowLeft") {
        e.preventDefault();
        skip();
      } else if (e.key === "k" || e.key === "K" || e.key === "ArrowRight") {
        e.preventDefault();
        readLater();
      } else if (e.key === "Enter") {
        e.preventDefault();
        openDetail();
      } else if (e.key === "Escape" || e.key === "1") {
        e.preventDefault();
        jumpTo(0);
      } else if (/^[2-9]$/.test(e.key)) {
        e.preventDefault();
        jumpTo(Number(e.key) - 1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [skip, readLater, openDetail, jumpTo]);

  const value = useMemo<DeckContextValue>(
    () => ({ issues, index, current, queueCount, seenIds, jumpTo, skip, readLater, openDetail }),
    [issues, index, current, queueCount, seenIds, jumpTo, skip, readLater, openDetail],
  );

  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}
