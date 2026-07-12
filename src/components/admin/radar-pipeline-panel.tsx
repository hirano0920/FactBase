"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageContainer, Section, SectionTitle } from "@/components/layout/page-container";
import type { PipelineInspectReport, PromotionEvaluation } from "@/lib/radar-pipeline-inspect";
import { XShareHelper } from "@/components/admin/x-share-helper";

const SKIP_LABEL: Record<PromotionEvaluation["skipReason"], string> = {
  would_publish: "記事化予定",
  not_buzz_source: "buzz以外",
  wrong_status: "PENDING以外",
  already_linked: "公開済み",
  stale: "鮮度切れ",
  buzz_score_low: "buzzScore不足",
  evidence_insufficient: "証拠不足",
  ranked_out: "順位外",
};

function BuzzBar({ score }: { score: number }) {
  return (
    <span className="inline-flex gap-0.5 font-mono text-xs" title={`buzzScore ${score}/4`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`inline-block h-2 w-2 rounded-sm ${i < score ? "bg-for" : "bg-border"}`}
        />
      ))}
    </span>
  );
}

function CandidateRow({ c, highlight }: { c: PromotionEvaluation; highlight?: boolean }) {
  return (
    <tr className={highlight ? "bg-for-muted/30" : undefined}>
      <td className="px-2 py-2 align-top">
        <BuzzBar score={c.buzzScore} />
        <span className="ml-1 text-xs text-ink-muted">{c.buzzScore}/4</span>
      </td>
      <td className="max-w-xs px-2 py-2 align-top text-sm">{c.title}</td>
      <td className="px-2 py-2 align-top text-xs text-ink-muted">
        {(c.buzzSources.length ? c.buzzSources.join(", ") : "—").replaceAll("_", " ")}
      </td>
      <td className="px-2 py-2 align-top text-xs">
        媒体{c.distinctNewsOutlets}
        {c.bonusSignals.length > 0 && ` · ${c.bonusSignals.join("+")}`}
      </td>
      <td className="px-2 py-2 align-top">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
            c.wouldSelect
              ? "bg-for-muted text-for"
              : c.skipReason === "ranked_out"
                ? "bg-amber-100 text-amber-900"
                : "bg-surface-muted text-ink-muted"
          }`}
        >
          {SKIP_LABEL[c.skipReason]}
        </span>
        <p className="mt-0.5 text-xs text-ink-faint">{c.skipDetail}</p>
      </td>
    </tr>
  );
}

export function RadarPipelinePanel() {
  const [report, setReport] = useState<PipelineInspectReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (live = false) => {
    if (live) setLiveLoading(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/radar-pipeline${live ? "?live=1" : ""}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      setReport(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込み失敗");
    } finally {
      setLoading(false);
      setLiveLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <PageContainer>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin" className="text-xs text-link underline">
            ← 管理ダッシュボード
          </Link>
          <h1 className="mt-1 text-xl font-bold text-ink">Radar トピック選定インスペクタ</h1>
          <p className="mt-1 text-sm text-ink-muted">
            どの話題がどのルートで記事候補・公開されるかを目視確認するための画面です。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => load(false)}
            disabled={loading}
            className="rounded-md border border-border bg-surface-raised px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {loading ? "更新中…" : "DB再読込"}
          </button>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={liveLoading}
            className="rounded-md border border-for/40 bg-for-muted px-3 py-1.5 text-xs font-semibold text-for disabled:opacity-50"
          >
            {liveLoading ? "取得中…" : "4ソースを今取得"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <Section>
        <SectionTitle>ルート概要</SectionTitle>
        <div className="space-y-2 text-sm text-ink-muted">
          <p>
            <strong className="text-ink">本番 cron: discover → promote のみ</strong> — Google Trends /
            Yahoo!リアルタイム / Yahoo!ニュースランキング / YouTube → 関連性判定 → 能動調査 → PENDING →
            promote（buzzScore≥{report?.thresholds.minBuzzScoreForPromotion ?? 2} & 証拠十分）。
            discover 1日7回 / promote ピーク3回（Actions もその時刻だけ起動）。
            detect・followup・summarize は cron 外（手動可）。
          </p>
        </div>
      </Section>

      {report?.liveBuzz && (
        <Section>
          <SectionTitle>① ライブ4ソース（nano前）</SectionTitle>
          <p className="mb-3 text-xs text-ink-muted">
            Trends {report.liveBuzz.googleTrends.length} / Yahoo RT{" "}
            {report.liveBuzz.yahooRealtime.length} / News{" "}
            {report.liveBuzz.yahooNewsRanking.length} / YouTube{" "}
            {report.liveBuzz.youtubeTrending.length}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-ink-muted">
                  <th className="px-2 py-1">buzz</th>
                  <th className="px-2 py-1">語/見出し</th>
                  <th className="px-2 py-1">一致ソース</th>
                </tr>
              </thead>
              <tbody>
                {report.liveBuzz.termPreviews.slice(0, 20).map((t) => (
                  <tr key={t.term} className="border-b border-border/60">
                    <td className="px-2 py-1.5">
                      <BuzzBar score={t.buzzScore} />
                    </td>
                    <td className="max-w-md px-2 py-1.5">{t.term}</td>
                    <td className="px-2 py-1.5 text-xs text-ink-muted">
                      {t.buzzSources.join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section>
        <SectionTitle>④ promote シミュレーション</SectionTitle>
        {report ? (
          <>
            <p className="mb-3 text-xs text-ink-muted">
              PENDING buzz {report.promotionSimulation.pendingBuzzCount}件 · 閾値 buzzScore≥
              {report.thresholds.minBuzzScoreForPromotion} · 各ピーク最大
              {report.thresholds.buzzArticlesPerWindow}本 · 鮮度
              {report.thresholds.candidateFreshnessHours}h
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left">
                <thead>
                  <tr className="border-b border-border text-xs text-ink-muted">
                    <th className="px-2 py-1">buzz</th>
                    <th className="px-2 py-1">トピック</th>
                    <th className="px-2 py-1">ソース</th>
                    <th className="px-2 py-1">証拠</th>
                    <th className="px-2 py-1">判定</th>
                  </tr>
                </thead>
                <tbody>
                  {report.promotionSimulation.selected.map((c) => (
                    <CandidateRow key={c.id} c={c} highlight />
                  ))}
                  {report.promotionSimulation.rejected.map((c) => (
                    <CandidateRow key={c.id} c={c} />
                  ))}
                  {report.promotionSimulation.pendingBuzzCount === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-4 text-sm text-ink-muted">
                        鮮度内の PENDING buzz 候補がありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-muted">読み込み中…</p>
        )}
      </Section>

      <Section>
        <SectionTitle>最近の公開争点（ルート付き）</SectionTitle>
        {report && (
          <ul className="space-y-3">
            {report.recentIssues.map((issue) => (
              <li key={issue.slug} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap gap-2 text-xs text-ink-muted">
                  <span>{new Date(issue.createdAt).toLocaleString("ja-JP")}</span>
                  <span className="rounded bg-surface-muted px-1.5 py-0.5 font-semibold">
                    {issue.routeLabel}
                  </span>
                  {issue.buzzScore != null && (
                    <span>
                      buzz={issue.buzzScore} [{issue.buzzSources.join(", ") || "—"}]
                    </span>
                  )}
                </div>
                <Link href={`/issues/${issue.slug}`} className="mt-1 block font-medium text-link underline">
                  {issue.title}
                </Link>
                {issue.timelineHint && (
                  <p className="mt-1 text-xs text-ink-faint">{issue.timelineHint}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {report && report.recentIssues.length > 0 && (
        <Section>
          <SectionTitle>X 手動投稿支援</SectionTitle>
          <XShareHelper
            issues={report.recentIssues.map((i) => ({ slug: i.slug, title: i.title }))}
          />
        </Section>
      )}

      {report && (
        <p className="mt-6 text-xs text-ink-faint">
          生成: {new Date(report.generatedAt).toLocaleString("ja-JP")} · CLI:{" "}
          <code className="rounded bg-surface-muted px-1">npx tsx scripts/radar/inspect-pipeline.ts --live</code>
        </p>
      )}
    </PageContainer>
  );
}
