"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CategoryBadge } from "@/components/ui/badge";
import { ChartBarIcon, MessageCircleIcon } from "@/components/ui/icons";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import type { RankingItem } from "@/types";

interface RankingListProps {
  ranking: RankingItem[];
}

/**
 * 自分が投票していない争点はパーセンテージを見せない（結果を見る前にまず読んでほしい設計を
 * 一覧表示でも維持する）。SSRはゲスト扱いで全件非公開のまま描画し、マウント後に
 * 自分の投票済みIDだけ取得して該当行を公開する。
 */
export function RankingList({ ranking }: RankingListProps) {
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (ranking.length === 0) return;
    let cancelled = false;
    const issueIds = ranking.map((item) => item.issue.id).join(",");
    (async () => {
      try {
        const res = await fetch(`/api/votes/mine?issueIds=${encodeURIComponent(issueIds)}`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { votedIssueIds: string[] };
        if (!cancelled) setRevealedIds(new Set(data.votedIssueIds));
      } catch {
        // ゲスト表示のまま継続
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ranking]);

  if (ranking.length === 0) {
    return (
      <p className="rounded-[20px] border border-border bg-surface-raised px-6 py-10 text-center text-sm text-ink-faint">
        まだ争点がありません
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {ranking.map((item, i) => {
        const revealed = revealedIds.has(item.issue.id);
        return (
          <Link
            key={item.issue.id}
            href={`/issues/${item.issue.slug}`}
            className="group flex animate-fade-slide-up items-center gap-4 rounded-[20px] border border-border bg-surface-raised p-4 no-underline transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_4px_16px_rgb(15_20_25_/_0.06)] sm:p-5"
            style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                item.rank === 1
                  ? "bg-accent-soft text-accent"
                  : "bg-surface-muted text-ink-faint",
              )}
            >
              {item.rank}
            </span>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5">
                <CategoryBadge category={item.issue.category} />
              </div>
              <p className="line-clamp-2 font-semibold text-ink transition-colors group-hover:text-accent">
                {item.issue.shareTitle || item.issue.title}
              </p>

              {revealed ? (
                <>
                  <div className="mt-2 flex h-1.5 max-w-xs overflow-hidden rounded-full bg-surface-muted">
                    <div className="bg-for" style={{ width: `${item.voteTally.percents.for}%` }} />
                    <div className="bg-against" style={{ width: `${item.voteTally.percents.against}%` }} />
                    <div className="bg-neutral/50" style={{ width: `${item.voteTally.percents.undecided}%` }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium tabular-nums text-ink-muted">
                    <span className="text-for">賛成 {formatPercent(item.voteTally.percents.for)}</span>
                    <span className="text-against">反対 {formatPercent(item.voteTally.percents.against)}</span>
                    <span>わからない {formatPercent(item.voteTally.percents.undecided)}</span>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-ink-faint">投票すると結果が見られます</p>
              )}

              <div className="mt-2 flex items-center gap-3 text-sm tabular-nums text-ink-muted">
                <span className="flex items-center gap-1 text-xs font-medium text-ink-faint">
                  <ChartBarIcon style={{ width: 13, height: 13 }} />
                  {formatNumber(item.voteTally.totalVoters)}
                </span>
                <span className="flex items-center gap-1 text-xs font-medium text-ink-faint">
                  <MessageCircleIcon style={{ width: 13, height: 13 }} />
                  {formatNumber(item.commentCount)}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
