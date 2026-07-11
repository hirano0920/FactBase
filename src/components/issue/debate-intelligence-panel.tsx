"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn, formatNumber } from "@/lib/utils";
import type { HistogramBin } from "@/lib/spectrum";
import type { CampTopComment } from "@/lib/debate-intelligence";

interface AnalyticsResponse {
  shift: { n: number; shiftPercent: number; shiftedCount?: number };
  afterReadN: number;
  detailed: boolean;
  histogram: HistogramBin[] | null;
  campMap: {
    for: CampTopComment | { userName: string } | null;
    against: CampTopComment | { userName: string } | null;
  } | null;
  acknowledged: {
    for: { body: string; userName: string } | null;
    against: { body: string; userName: string } | null;
  };
  mvp: {
    stance: "for" | "against";
    userName: string;
    body: string;
    crossHelpful: number;
  } | null;
}

interface DebateIntelligencePanelProps {
  slug: string;
  isPlus: boolean;
}

function isFullCamp(c: CampTopComment | { userName: string } | null): c is CampTopComment {
  return c !== null && "body" in c && "bridgingScore" in c;
}

function HistogramChart({ bins }: { bins: HistogramBin[] }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div className="flex h-16 items-end gap-0.5" aria-label="読了後の立場分布">
      {bins.map((bin) => (
        <div
          key={bin.min}
          className="flex-1 rounded-t bg-accent/60 transition-all"
          style={{ height: `${(bin.count / max) * 100}%`, minHeight: bin.count > 0 ? 4 : 0 }}
          title={`${bin.min}〜${bin.max}: ${bin.count}人`}
        />
      ))}
    </div>
  );
}

export function DebateIntelligencePanel({ slug, isPlus }: DebateIntelligencePanelProps) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/issues/${encodeURIComponent(slug)}/analytics`);
        if (!res.ok || cancelled) return;
        setData((await res.json()) as AnalyticsResponse);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-5 text-sm text-ink-muted">
        層の動きを読み込み中…
      </div>
    );
  }

  if (!data || data.shift.n === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-muted p-5 text-center text-sm text-ink-muted">
        読前→読後のデータがまだありません。投票して記事を読むと、層の動きがここに表示されます。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 層の動き */}
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <h3 className="text-sm font-extrabold text-ink">📊 層の動き</h3>
        <p className="mt-2 text-2xl font-extrabold tabular-nums text-ink">
          {data.shift.shiftPercent}%
          <span className="ml-2 text-sm font-normal text-ink-muted">が読了後に立場を動かした</span>
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          TwoSidesで読前・読後の両方に答えた {formatNumber(data.shift.n)} 人が対象（n={data.shift.n}）
        </p>

        {data.detailed && data.histogram && data.afterReadN > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold text-ink-secondary">沈黙の多数派（読了後）</p>
            <HistogramChart bins={data.histogram} />
            <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
              <span>強く反対</span>
              <span>中立</span>
              <span>強く賛成</span>
            </div>
          </div>
        ) : (
          !isPlus && (
            <p className="mt-3 text-xs text-ink-muted">
              <Link href="/pricing" className="font-semibold text-link">
                Plus
              </Link>
              で分布の詳細が見られます
            </p>
          )
        )}
      </div>

      {/* 両陣営が認めた意見（C-1） */}
      {(data.acknowledged.for || data.acknowledged.against) && (
        <div className="rounded-xl border border-accent/25 bg-accent/5 p-5">
          <h3 className="text-sm font-extrabold text-ink">🤝 両陣営が認めた意見</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["for", "against"] as const).map((side) => {
              const item = data.acknowledged[side];
              if (!item) return null;
              return (
                <div
                  key={side}
                  className={cn(
                    "rounded-lg border bg-surface-raised p-3 text-sm",
                    side === "for" ? "border-for/30" : "border-against/30",
                  )}
                >
                  <p className="text-xs font-bold text-ink-faint">
                    {side === "for" ? "賛成側" : "反対側"} · {item.userName}
                  </p>
                  <p className="mt-1 leading-relaxed text-ink-secondary">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MVP */}
      {data.mvp && (
        <div className="rounded-xl border border-warm/40 bg-warm-muted/30 p-5">
          <h3 className="text-sm font-extrabold text-ink">👑 この論題のMVP</h3>
          <p className="mt-1 text-xs text-ink-muted">
            {data.mvp.stance === "for" ? "賛成派" : "反対派"} · {data.mvp.userName}
            {data.mvp.crossHelpful > 0 &&
              ` · 相手陣営から ${formatNumber(data.mvp.crossHelpful)} 件「参考になった」`}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{data.mvp.body}</p>
        </div>
      )}

      {/* 両陣営マップ（Plus） */}
      {data.campMap && (data.campMap.for || data.campMap.against) && (
        <div className="rounded-xl border border-border bg-surface-raised p-5">
          <h3 className="text-sm font-extrabold text-ink">🗺️ 両陣営論点マップ</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["for", "against"] as const).map((side) => {
              const camp = data.campMap![side];
              if (!camp) return null;
              return (
                <div
                  key={side}
                  className={cn(
                    "rounded-lg border p-3",
                    side === "for" ? "border-for/30 bg-for-muted/20" : "border-against/30 bg-against-muted/20",
                  )}
                >
                  <p className="text-xs font-bold text-ink-faint">
                    {side === "for" ? "賛成" : "反対"} · 越境評価トップ
                  </p>
                  {isFullCamp(camp) ? (
                    <>
                      <p className="mt-1 text-sm text-ink-secondary">{camp.body.slice(0, 160)}</p>
                      <p className="mt-2 text-xs tabular-nums text-ink-faint">
                        参考 {formatNumber(camp.helpfulCount)} · 越境 {formatNumber(camp.crossHelpful)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-ink-muted">{camp.userName} の意見がトップ</p>
                  )}
                </div>
              );
            })}
          </div>
          {!isPlus && (
            <p className="mt-3 text-xs text-ink-muted">
              <Link href="/pricing" className="font-semibold text-link">
                Plus
              </Link>
              で論点の全文・越境スコアが見られます
            </p>
          )}
        </div>
      )}
    </div>
  );
}
