"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { VoteChoiceId } from "@/lib/constants";
import type { PoliticianSupportStats } from "@/lib/politician-votes";

/**
 * 政治家への評価投票パネル（常設）。
 * 「人格への好き嫌い」ではなく「行動・発言・国会活動への評価」という枠付けを文言で必ず維持する。
 * 総数だけでなく「直近1週間の割合」と「その差（スイング）」を出すのが核心
 * （スナップショットしか出ない人気投票サイトとの differentiator。「今動いてる」が再訪の理由になる）。
 */

const CHOICES: { id: VoteChoiceId; label: string; activeClass: string }[] = [
  { id: "for", label: "評価する", activeClass: "border-for bg-for-muted text-for" },
  { id: "undecided", label: "わからない", activeClass: "border-neutral bg-neutral-muted text-neutral" },
  { id: "against", label: "評価しない", activeClass: "border-against bg-against-muted text-against" },
];

function StatsBar({ percents, n }: { percents: Record<VoteChoiceId, number>; n: number }) {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-muted">
        <div className="bg-for transition-all" style={{ width: `${percents.for}%` }} />
        <div className="bg-neutral transition-all" style={{ width: `${percents.undecided}%` }} />
        <div className="bg-against transition-all" style={{ width: `${percents.against}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-ink-secondary">
        <span className="font-semibold text-for">評価する {percents.for}%</span>
        <span className="text-neutral">わからない {percents.undecided}%</span>
        <span className="font-semibold text-against">評価しない {percents.against}%</span>
      </div>
      <p className="mt-1 text-right text-[11px] text-ink-faint">n={n.toLocaleString()}</p>
    </div>
  );
}

export function PoliticianVotePanel({ slug }: { slug: string }) {
  const [stats, setStats] = useState<PoliticianSupportStats | null>(null);
  const [myVote, setMyVote] = useState<VoteChoiceId | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/politicians/${encodeURIComponent(slug)}/vote`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setStats(data.stats);
        setMyVote(data.myVote);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const cast = useCallback(
    async (choice: VoteChoiceId) => {
      if (pending) return;
      setPending(true);
      setNeedsLogin(false);
      try {
        const res = await fetch(`/api/politicians/${encodeURIComponent(slug)}/vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ choice }),
        });
        if (res.status === 401) {
          setNeedsLogin(true);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        setStats(data.stats);
        setMyVote(data.myVote);
      } finally {
        setPending(false);
      }
    },
    [slug, pending],
  );

  const dominantDelta = (() => {
    if (!stats?.deltaPoints) return null;
    const entries = [
      { id: "for" as const, label: "評価する", delta: stats.deltaPoints.for },
      { id: "against" as const, label: "評価しない", delta: stats.deltaPoints.against },
    ];
    const top = entries.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    return Math.abs(top.delta) >= 1 ? top : null;
  })();

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4">
      <p className="text-sm font-bold text-ink">この政治家の活動を評価しますか？</p>
      <p className="mt-0.5 text-xs text-ink-faint">
        人柄ではなく、これまでの行動・発言・国会での活動に対する評価として投票してください。変更はいつでもできます。
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={pending}
            onClick={() => cast(c.id)}
            className={cn(
              "rounded-lg border px-2 py-2.5 text-sm font-semibold transition-colors",
              myVote === c.id
                ? c.activeClass
                : "border-border bg-surface text-ink-secondary hover:border-ink-faint",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {needsLogin && (
        <p className="mt-2 text-xs text-amber-700">
          投票には
          <Link href="/login" className="font-semibold underline">
            ログイン
          </Link>
          が必要です（1人1票のため）
        </p>
      )}

      {stats && stats.total.n > 0 && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-ink-secondary">全体</p>
            <StatsBar percents={stats.total.percents} n={stats.total.n} />
          </div>
          {stats.recent && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-ink-secondary">直近1週間</p>
              <StatsBar percents={stats.recent.percents} n={stats.recent.n} />
              {dominantDelta && (
                <p
                  className={cn(
                    "mt-1.5 text-xs font-bold",
                    dominantDelta.id === "for" ? "text-for" : "text-against",
                  )}
                >
                  「{dominantDelta.label}」が全体より{" "}
                  {dominantDelta.delta > 0 ? "+" : ""}
                  {dominantDelta.delta}pt {dominantDelta.delta > 0 ? "多い（上昇中）" : "少ない（下降中）"}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
