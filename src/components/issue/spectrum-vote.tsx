"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HistogramBin, ShiftResult } from "@/lib/spectrum";

interface AnalyticsResponse {
  shift: ShiftResult;
  afterReadN: number;
  detailed: boolean;
  histogram?: HistogramBin[];
}

interface SpectrumVoteProps {
  slug: string;
  canViewDetail: boolean;
}

type Step = "prompt" | "sliding" | "done";

/**
 * 読了ゲート(Phase3-2)+沈黙の多数派ヒートマップ(Phase3-3)。
 * 自動のスクロール深度計測ではなく、本人の「読んだ」という自己申告ボタンをトリガーにする
 * （読んでいないのに勝手に読了扱いにしない、という設計判断）。
 */
export function SpectrumVote({ slug, canViewDetail }: SpectrumVoteProps) {
  const [step, setStep] = useState<Step>("prompt");
  const [intensity, setIntensity] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(slug)}/spectrum-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intensity }),
      });
      if (!res.ok) {
        setError("送信に失敗しました。もう一度お試しください。");
        return;
      }
      setStep("done");
      const analyticsRes = await fetch(`/api/issues/${encodeURIComponent(slug)}/analytics`);
      if (analyticsRes.ok) {
        setAnalytics((await analyticsRes.json()) as AnalyticsResponse);
      }
    } catch {
      setError("送信に失敗しました。もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "prompt") {
    return (
      <div className="rounded-md border border-border bg-surface-muted px-5 py-4 text-center">
        <p className="mb-3 text-sm text-ink-secondary">
          両方の意見を読んで、考えは変わりましたか？
        </p>
        <Button variant="secondary" size="sm" onClick={() => setStep("sliding")}>
          両論を読んだ→もう一度答える
        </Button>
      </div>
    );
  }

  if (step === "sliding") {
    return (
      <div className="rounded-md border border-border bg-surface-muted px-5 py-5">
        <p className="mb-4 text-sm font-medium text-ink">今の率直な気持ちに近い位置へ</p>
        <div className="mb-2 flex justify-between text-xs font-medium text-ink-secondary">
          <span className="text-against">反対</span>
          <span>まだ決められない</span>
          <span className="text-for">賛成</span>
        </div>
        <input
          type="range"
          min={-100}
          max={100}
          value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          className="w-full accent-accent"
          aria-label="賛成〜反対の度合い"
        />
        {error && <p className="mt-2 text-xs text-against">{error}</p>}
        <div className="mt-4 flex justify-center">
          <Button variant="primary" size="sm" onClick={submit} disabled={submitting}>
            {submitting ? "送信中..." : "この位置で回答する"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface-muted px-5 py-4">
      <p className="mb-3 text-center text-sm font-medium text-ink">回答ありがとうございました</p>
      {analytics && (
        <div className="space-y-3">
          <p className="text-center text-xs text-ink-secondary">
            読了後に意見が変わった人:{" "}
            <span className="font-bold text-ink">{analytics.shift.shiftPercent}%</span>
            {" "}
            <span>(n={analytics.shift.n})</span>
          </p>
          {analytics.detailed && analytics.histogram ? (
            <SpectrumHistogram bins={analytics.histogram} n={analytics.afterReadN} />
          ) : canViewDetail ? null : (
            <p className="text-center text-xs text-ink-secondary">
              分布の詳細はPlus/Proで見られます
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SpectrumHistogram({ bins, n }: { bins: HistogramBin[]; n: number }) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div>
      <div className="flex h-16 items-end gap-0.5">
        {bins.map((bin, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-t-sm",
              bin.max <= -10 ? "bg-against/60" : bin.min >= 10 ? "bg-for/60" : "bg-neutral/60",
            )}
            style={{ height: `${(bin.count / max) * 100}%`, minHeight: bin.count > 0 ? "2px" : "0" }}
            title={`${Math.round(bin.min)}〜${Math.round(bin.max)}: ${bin.count}件`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-secondary">
        <span>反対</span>
        <span>賛成</span>
      </div>
      <p className="mt-1 text-center text-[10px] text-ink-secondary">母数 n={n}</p>
    </div>
  );
}
