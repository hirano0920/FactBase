"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORIES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ChartBarIcon, MessageCircleIcon, FlameIcon } from "@/components/ui/icons";
import type { ParticipatedIssue } from "@/lib/data";

type ParticipatedState =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "user"; issues: ParticipatedIssue[] };

function statusLine(issue: ParticipatedIssue) {
  if (issue.hasUpdate) return { text: "新しいコメントがあります", className: "text-hot" };
  if (issue.hasCommented) return { text: "コメント参加済み・新着なし", className: "text-ink-faint" };
  return { text: "投票のみ・動きなし", className: "text-ink-faint" };
}

/** 左カラム「あなたが参加したスレッド」。SSRをブロックせず、ログイン時だけ遅延取得する。 */
export function ParticipatedRail() {
  const [state, setState] = useState<ParticipatedState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/issues/participated");
        if (cancelled) return;
        if (res.status === 401) {
          setState({ kind: "guest" });
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { issues: ParticipatedIssue[] };
        setState({ kind: "user", issues: data.issues });
      } catch {
        if (!cancelled) setState({ kind: "guest" });
      }
    };

    const timer = setTimeout(load, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <aside className="overflow-hidden rounded-2xl border border-border bg-surface-raised">
        <p className="px-3.5 pb-2 pt-3 text-xs font-medium text-ink">あなたが参加したスレッド</p>

        {state.kind === "loading" && <p className="px-3.5 pb-3.5 text-xs text-ink-faint">読み込み中…</p>}

        {state.kind === "guest" && (
          <p className="px-3.5 pb-3.5 text-xs leading-relaxed text-ink-faint">
            <Link href="/login" className="font-semibold text-link">
              ログイン
            </Link>
            して投票すると、参加したスレッドがここに並びます。動きがあったスレッドには印が付きます。
          </p>
        )}

        {state.kind === "user" && state.issues.length === 0 && (
          <div className="px-3.5 pb-4 text-center">
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft">
              <FlameIcon className="text-accent" style={{ width: 17, height: 17 }} />
            </div>
            <p className="mb-1 text-xs font-medium text-ink">まだ参加したスレッドがありません</p>
            <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
              気になる争点に投票すると、ここに並んで動きを追えるようになります
            </p>
            <Link
              href="/ranking"
              className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1.5 text-[11px] font-medium text-accent no-underline hover:bg-accent/20"
            >
              人気の争点を見る →
            </Link>
          </div>
        )}

        {state.kind === "user" && state.issues.length > 0 && (
          <ul>
            {state.issues.map((issue) => {
              const status = statusLine(issue);
              return (
                <li key={issue.slug} className="border-t border-border">
                  <Link
                    href={`/issues/${issue.slug}`}
                    className="relative flex items-start gap-2.5 px-3.5 py-2.5 no-underline hover:bg-surface-muted"
                  >
                    {issue.hasUpdate && (
                      <span
                        aria-hidden="true"
                        className="absolute left-1.5 top-5 h-1.5 w-1.5 rounded-full bg-hot"
                      />
                    )}
                    <div
                      className={cn(
                        "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px]",
                        issue.hasCommented ? "bg-accent-soft" : "bg-surface-muted",
                      )}
                    >
                      {issue.hasCommented ? (
                        <MessageCircleIcon
                          className="text-accent"
                          style={{ width: 16, height: 16 }}
                        />
                      ) : (
                        <ChartBarIcon className="text-ink-secondary" style={{ width: 16, height: 16 }} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-ink-secondary">
                          {CATEGORIES.find((c) => c.id === issue.category)?.label ?? issue.category}
                        </span>
                        {issue.hasCommented && (
                          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                            コメント済み
                          </span>
                        )}
                      </div>
                      <p className="mb-0.5 truncate text-xs text-ink-secondary">{issue.title}</p>
                      <p className={cn("text-[11px] font-medium", status.className)}>{status.text}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
    </aside>
  );
}
