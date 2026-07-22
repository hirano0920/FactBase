"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageContainer, Section, SectionTitle } from "@/components/layout/page-container";
import { describeHeldReason, type HeldReasonTone } from "@/lib/radar-held-reason";

interface RadarHealth {
  alive: boolean;
  lastSourceEventAt: string | null;
  lastCandidateEvaluatedAt: string | null;
  minutesSinceLastEvent: number | null;
  todayIssueCount: number;
  todayCandidateCount: number;
}

interface OverviewData {
  radarHealth: RadarHealth;
  surgingIssues: Array<{
    id: string;
    slug: string;
    title: string;
    track: "DEBATE" | "NEWS";
    underReview: boolean;
    recentVotes: number;
    recentComments: number;
    surgeScore: number;
  }>;
  counts: {
    pendingCases: number;
    underReviewIssues: number;
    heldRadar: number;
    openReports: number;
  };
  cases: Array<{
    id: string;
    source: string;
    createdAt: string;
    aiVerdict: unknown;
    comment: {
      id: string;
      body: string;
      moderationStatus: string;
      issue: { slug: string; title: string };
      user: { name: string | null; email: string | null };
      appeal: { reason: string; createdAt: string } | null;
      reports: Array<{ reason: string | null; reporter: { name: string | null; email: string | null } }>;
    };
  }>;
  flaggedIssues: Array<{
    slug: string;
    title: string;
    confirmation: string;
    lead: string;
    qualityReports: Array<{ reason: string | null; reporter: { name: string | null; email: string | null } }>;
  }>;
  recentRadar: Array<{
    slug: string;
    title: string;
    confirmation: string;
    underReview: boolean;
    createdAt: string;
    lead: string;
    _count: { qualityReports: number; comments: number };
  }>;
  heldRadar: Array<{
    id: string;
    title: string;
    classification: string | null;
    decision: string | null;
    riskFlags: string[];
    createdAt: string;
  }>;
  openReports: Array<{
    id: string;
    reason: string | null;
    comment: { body: string; issue: { slug: string; title: string } };
    reporter: { name: string | null; email: string | null };
  }>;
}

function ActionButton({
  onClick,
  disabled,
  variant = "default",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "success";
  children: React.ReactNode;
}) {
  const styles =
    variant === "danger"
      ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
      : variant === "success"
        ? "border-for/40 bg-for-muted text-for hover:opacity-90"
        : "border-border bg-surface-raised text-ink hover:bg-surface-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

function RadarHealthBanner({ health }: { health: RadarHealth }) {
  const style = health.alive
    ? "border-for/30 bg-for-muted/40 text-for"
    : "border-red-300 bg-red-50 text-red-800";
  return (
    <div className={`rounded-lg border p-4 text-sm ${style}`}>
      <p className="font-bold">
        {health.alive ? "🟢 Radar稼働中" : "🔴 Radar停止の疑いあり"}
      </p>
      <p className="mt-1 text-xs opacity-90">
        {health.lastCandidateEvaluatedAt
          ? `最終候補更新: ${new Date(health.lastCandidateEvaluatedAt).toLocaleString("ja-JP")}（${health.minutesSinceLastEvent}分前）`
          : "候補更新履歴なし"}
        {" · "}本日の公開 {health.todayIssueCount}件 / 評価した候補 {health.todayCandidateCount}件
      </p>
      {!health.alive && (
        <p className="mt-1 text-xs">
          discover（最大約4時間間隔）で候補が5時間以上更新されていません。GitHub Actionsの実行履歴を確認してください（0件公開自体は静かなニュース日なら正常です）。
        </p>
      )}
    </div>
  );
}

interface WorkflowRunStatus {
  configured: boolean;
  status: string | null;
  conclusion: string | null;
  htmlUrl: string | null;
  createdAt: string | null;
  runNumber: number | null;
}

const RUN_STATUS_LABEL: Record<string, string> = {
  queued: "⏳ 待機中",
  in_progress: "🔵 実行中",
};
const RUN_CONCLUSION_LABEL: Record<string, string> = {
  success: "🟢 成功",
  failure: "🔴 失敗",
  cancelled: "⚪ キャンセル",
  timed_out: "🔴 タイムアウト",
};

/** GitHub Actionsの実行状況表示＋手動実行。GITHUB_TOKEN未設定時は案内だけ出す */
function WorkflowRunPanel() {
  const [run, setRun] = useState<WorkflowRunStatus | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/radar-workflow");
      if (res.ok) setRun(await res.json());
    } catch {
      // 静かに失敗（このパネルはあくまで補助情報）
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function trigger() {
    setTriggering(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/radar-workflow", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      setMsg("実行をトリガーしました（反映まで数十秒かかります）");
      setTimeout(load, 5000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "実行に失敗しました");
    } finally {
      setTriggering(false);
    }
  }

  if (!run) return null;

  if (!run.configured) {
    return (
      <div className="rounded-lg border border-border bg-surface-muted p-4 text-xs text-ink-muted">
        GitHub Actions連携は未設定です（GITHUB_TOKEN未設定）。fine-grained PAT（対象リポジトリのみ・Actions:
        Read and write権限）を発行し環境変数に設定すると、ここから実行状況の確認と手動実行ができるようになります。
      </div>
    );
  }

  const statusLabel =
    run.status === "completed"
      ? (run.conclusion && RUN_CONCLUSION_LABEL[run.conclusion]) || run.conclusion
      : (run.status && RUN_STATUS_LABEL[run.status]) || run.status;

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-bold">GitHub Actions（Radar）: </span>
          {run.runNumber ? (
            <>
              {statusLabel}
              {run.htmlUrl && (
                <Link href={run.htmlUrl} target="_blank" className="ml-2 text-xs text-link underline">
                  #{run.runNumber} を見る →
                </Link>
              )}
              {run.createdAt && (
                <span className="ml-2 text-xs text-ink-faint">
                  {new Date(run.createdAt).toLocaleString("ja-JP")}
                </span>
              )}
            </>
          ) : (
            <span className="text-ink-muted">実行履歴を取得できませんでした</span>
          )}
        </div>
        <ActionButton onClick={trigger} disabled={triggering}>
          {triggering ? "実行中…" : "今すぐ実行"}
        </ActionButton>
      </div>
      {msg && <p className="mt-2 text-xs text-ink-muted">{msg}</p>}
    </div>
  );
}

/** クリックすると該当セクションへスクロールする。0件でもどこに何件あるか一目でわかるようにする */
function CountCard({ label, value, targetId }: { label: string; value: number; targetId: string }) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
      className="rounded-lg border border-border bg-surface-raised p-4 text-center shadow-card transition hover:border-accent/50 hover:bg-surface-muted"
    >
      <div className="text-2xl font-extrabold text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
    </button>
  );
}

const HELD_REASON_TONE_CLASS: Record<HeldReasonTone, string> = {
  review: "border-red-300 bg-red-50 text-red-800",
  quality: "border-amber-300 bg-amber-50 text-amber-800",
  transient: "border-border bg-surface-muted text-ink-muted",
  unknown: "border-border bg-surface-muted text-ink-muted",
};

function HeldReasonBadge({ tone, label }: { tone: HeldReasonTone; label: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${HELD_REASON_TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

/**
 * HELD一覧を理由カテゴリ別に集計して先頭に出す。「本当にレビューが必要なもの」と
 * 「時間経過やパイプライン設計上ただ待てば解消するもの」を一目で区別できるようにする
 * （decisionの生ログを一件ずつ読まないと分からない、という問題への対応）。
 * バッジ自体をクリックすると下のリストがその理由だけに絞り込まれる（フィルタ）。
 */
function HeldReasonSummary({
  items,
  activeFilter,
  onFilterChange,
}: {
  items: Array<{ decision: string | null }>;
  activeFilter: string | null;
  onFilterChange: (label: string | null) => void;
}) {
  const counts = new Map<string, { label: string; tone: HeldReasonTone; count: number }>();
  for (const item of items) {
    const reason = describeHeldReason(item.decision);
    const existing = counts.get(reason.label);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(reason.label, { label: reason.label, tone: reason.tone, count: 1 });
    }
  }
  const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {sorted.map((r) => {
        const isActive = activeFilter === r.label;
        return (
          <button
            key={r.label}
            type="button"
            onClick={() => onFilterChange(isActive ? null : r.label)}
            className={`rounded-full border px-2 py-0.5 text-xs font-medium transition ${HELD_REASON_TONE_CLASS[r.tone]} ${
              isActive ? "ring-2 ring-accent" : "opacity-90 hover:opacity-100"
            }`}
          >
            {r.label} × {r.count}
          </button>
        );
      })}
      {activeFilter && (
        <button
          type="button"
          onClick={() => onFilterChange(null)}
          className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-muted underline hover:text-ink"
        >
          絞り込み解除
        </button>
      )}
    </div>
  );
}

export function AdminDashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  // 実行中のアクションの対象1件だけを識別するキー（issue.slug/c.id等）。
  // 以前はAPIのURL文字列を丸ごと入れており、!!busyで全ボタンを一括disableしていたため、
  // ある1件を処理している間、無関係な他の行のボタンまで押せなくなっていた。
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [heldFilter, setHeldFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/overview");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // トーストは数秒で自動的に消す（消さないと、次のアクションまで画面上部に残り続け
  // 「今どの操作の結果か」が分かりにくくなる）
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  /**
   * itemKey: 実行中インジケータをその行だけに限定するための識別子。
   * confirmMessage: 指定すると実行前にwindow.confirmで確認する（誤クリックでの
   *   非公開・削除・却下を防ぐ。以前は即座に実行されていた）。
   * onSuccess: 成功直後にローカルstateから即座に取り除く（楽観的更新）。
   *   フル再取得(load())の完了を待たずに一覧からその場で消えるようにする。
   */
  async function postJson(
    itemKey: string,
    url: string,
    body: object,
    options?: { confirmMessage?: string; onSuccess?: () => void },
  ) {
    if (options?.confirmMessage && !window.confirm(options.confirmMessage)) return;
    setBusy(itemKey);
    setToast(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      options?.onSuccess?.();
      setToast("完了しました");
      // カウント等の整合性を裏で取り直す。楽観的更新済みなので待たずに進める。
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <PageContainer width="content">
        <p className="text-ink-muted">読み込み中…</p>
      </PageContainer>
    );
  }

  if (error && !data) {
    return (
      <PageContainer width="content">
        <p className="text-red-700">{error}</p>
      </PageContainer>
    );
  }

  if (!data) return null;

  return (
    <PageContainer width="content" className="space-y-8">
      <header>
        <h1 className="text-2xl font-extrabold text-ink">管理ダッシュボード</h1>
        <p className="mt-2 text-sm text-ink-muted">
          争点の非公開・品質報告・コメント通報・異議申立をここで処理します。
          <Link href="/admin/radar-pipeline" className="ml-2 text-link underline">
            Radar トピック選定を見る →
          </Link>
          <Link href="/admin/domain-trust" className="ml-2 text-link underline">
            ドメイン信頼度フィルタ →
          </Link>
        </p>
        {toast && (
          <p className="mt-3 rounded-md border border-for/30 bg-for-muted px-3 py-2 text-sm text-for">
            {toast}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </header>

      <RadarHealthBanner health={data.radarHealth} />
      <WorkflowRunPanel />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CountCard label="モデレーション待ち" value={data.counts.pendingCases} targetId="section-cases" />
        <CountCard label="争点・品質確認" value={data.counts.underReviewIssues} targetId="section-flagged" />
        <CountCard label="Radar HELD" value={data.counts.heldRadar} targetId="section-held" />
        <CountCard label="未処理通報" value={data.counts.openReports} targetId="section-open-reports" />
      </div>

      {/* 監査運用の起点: 全件レビューはせず「バズってるもの」と「通報が来たもの」だけを見る。
          このセクションが「バズってるもの」側の一覧（直近6時間の投票+コメント×2の降順） */}
      <Section id="section-surging">
        <SectionTitle>
          🔥 急上昇（直近6時間） {data.surgingIssues.length > 0 && `（${data.surgingIssues.length}件）`}
        </SectionTitle>
        {data.surgingIssues.length === 0 ? (
          <p className="text-sm text-ink-muted">急上昇中の争点はありません</p>
        ) : (
          <ul className="space-y-2">
            {data.surgingIssues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/issues/${issue.slug}`}
                    className="text-sm font-semibold text-ink underline-offset-2 hover:underline"
                    target="_blank"
                  >
                    {issue.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {issue.track === "NEWS" ? "News" : "Debate"} · 投票 {issue.recentVotes} · コメント{" "}
                    {issue.recentComments}
                    {issue.underReview && " · ⚠️ 確認中"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
                  {issue.surgeScore}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="section-recent-radar">
        <SectionTitle>
          Radar 自動公開争点（ワンタップ非公開） {data.recentRadar.length > 0 && `（${data.recentRadar.length}件）`}
        </SectionTitle>
        {data.recentRadar.length === 0 ? (
          <p className="text-sm text-ink-muted">公開中の Radar 争点はありません</p>
        ) : (
          <ul className="space-y-4">
            {data.recentRadar.map((issue) => (
              <li key={issue.slug} className="rounded-md border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/issues/${issue.slug}`}
                      className="font-semibold text-ink underline-offset-2 hover:underline"
                      target="_blank"
                    >
                      {issue.title}
                    </Link>
                    <p className="mt-1 text-xs text-ink-muted">
                      {issue.confirmation} · 報告 {issue._count.qualityReports} · コメント{" "}
                      {issue._count.comments}
                      {issue.underReview && " · 確認中"}
                    </p>
                    {issue.lead && (
                      <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{issue.lead}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      variant="danger"
                      disabled={busy === issue.slug}
                      onClick={() =>
                        postJson(
                          issue.slug,
                          `/api/admin/issues/${issue.slug}`,
                          { action: "unpublish" },
                          {
                            confirmMessage: `「${issue.title}」を非公開にします。よろしいですか？`,
                            onSuccess: () =>
                              setData((d) =>
                                d
                                  ? { ...d, recentRadar: d.recentRadar.filter((i) => i.slug !== issue.slug) }
                                  : d,
                              ),
                          },
                        )
                      }
                    >
                      非公開
                    </ActionButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="section-flagged">
        <SectionTitle>
          品質報告 — 確認待ち争点 {data.flaggedIssues.length > 0 && `（${data.flaggedIssues.length}件）`}
        </SectionTitle>
        {data.flaggedIssues.length === 0 ? (
          <p className="text-sm text-ink-muted">確認待ちの争点はありません 🎉</p>
        ) : (
          <ul className="space-y-4">
            {data.flaggedIssues.map((issue) => (
              <li key={issue.slug} className="rounded-md border border-amber-300/50 bg-amber-50/50 p-4">
                <Link
                  href={`/issues/${issue.slug}`}
                  className="font-semibold text-ink underline-offset-2 hover:underline"
                  target="_blank"
                >
                  {issue.title}
                </Link>
                <p className="mt-1 text-sm text-ink-muted line-clamp-2">{issue.lead}</p>
                {issue.qualityReports.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                    {issue.qualityReports.slice(0, 5).map((r, i) => (
                      <li key={i}>
                        · {r.reason || "（理由なし）"} — {r.reporter.email ?? r.reporter.name}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton
                    variant="success"
                    disabled={busy === issue.slug}
                    onClick={() =>
                      postJson(
                        issue.slug,
                        `/api/admin/issues/${issue.slug}`,
                        { action: "clear" },
                        {
                          onSuccess: () =>
                            setData((d) =>
                              d
                                ? { ...d, flaggedIssues: d.flaggedIssues.filter((i) => i.slug !== issue.slug) }
                                : d,
                            ),
                        },
                      )
                    }
                  >
                    問題なし（公開継続）
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    disabled={busy === issue.slug}
                    onClick={() =>
                      postJson(
                        issue.slug,
                        `/api/admin/issues/${issue.slug}`,
                        { action: "archive" },
                        {
                          confirmMessage: `「${issue.title}」を品質不良として非公開にします。よろしいですか？`,
                          onSuccess: () =>
                            setData((d) =>
                              d
                                ? { ...d, flaggedIssues: d.flaggedIssues.filter((i) => i.slug !== issue.slug) }
                                : d,
                            ),
                        },
                      )
                    }
                  >
                    品質不良で非公開
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="section-cases">
        <SectionTitle>
          コメント — 通報・異議申立キュー {data.cases.length > 0 && `（${data.cases.length}件）`}
        </SectionTitle>
        {data.cases.length === 0 ? (
          <p className="text-sm text-ink-muted">未処理ケースはありません 🎉</p>
        ) : (
          <ul className="space-y-6">
            {data.cases.map((c) => (
              <li key={c.id} className="rounded-md border border-border p-4">
                <div className="mb-2 flex flex-wrap gap-2 text-xs text-ink-muted">
                  <span className="rounded bg-surface-muted px-2 py-0.5 font-mono">{c.id.slice(0, 8)}</span>
                  <span>{c.source === "appeal" ? "異議申立" : "通報"}</span>
                  <span>{c.comment.moderationStatus}</span>
                  <Link
                    href={`/issues/${c.comment.issue.slug}`}
                    className="underline"
                    target="_blank"
                  >
                    {c.comment.issue.title}
                  </Link>
                </div>
                <p className="whitespace-pre-wrap text-sm text-ink">{c.comment.body}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  投稿者: {c.comment.user.email ?? c.comment.user.name ?? "—"}
                </p>
                {c.comment.appeal && (
                  <p className="mt-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                    <strong>異議理由:</strong> {c.comment.appeal.reason}
                  </p>
                )}
                {c.comment.reports.length > 0 && (
                  <ul className="mt-2 text-xs text-ink-muted">
                    {c.comment.reports.map((r, i) => (
                      <li key={i}>
                        通報: {r.reason || "（理由なし）"} — {r.reporter.email ?? r.reporter.name}
                      </li>
                    ))}
                  </ul>
                )}
                {c.aiVerdict != null && (
                  <pre className="mt-2 overflow-x-auto rounded bg-surface-muted p-2 text-xs">
                    AI参考: {JSON.stringify(c.aiVerdict, null, 0)}
                  </pre>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.source === "appeal" ? (
                    <>
                      <ActionButton
                        variant="success"
                        disabled={busy === c.id}
                        onClick={() =>
                          postJson(
                            c.id,
                            `/api/admin/moderation-cases/${c.id}`,
                            { action: "accept-appeal" },
                            { onSuccess: () => setData((d) => (d ? { ...d, cases: d.cases.filter((x) => x.id !== c.id) } : d)) },
                          )
                        }
                      >
                        異議認容（復帰）
                      </ActionButton>
                      <ActionButton
                        variant="danger"
                        disabled={busy === c.id}
                        onClick={() =>
                          postJson(
                            c.id,
                            `/api/admin/moderation-cases/${c.id}`,
                            { action: "reject-appeal" },
                            {
                              confirmMessage: "異議申立を棄却します。よろしいですか？",
                              onSuccess: () => setData((d) => (d ? { ...d, cases: d.cases.filter((x) => x.id !== c.id) } : d)),
                            },
                          )
                        }
                      >
                        異議棄却
                      </ActionButton>
                    </>
                  ) : (
                    <>
                      <ActionButton
                        variant="danger"
                        disabled={busy === c.id}
                        onClick={() =>
                          postJson(
                            c.id,
                            `/api/admin/moderation-cases/${c.id}`,
                            { action: "remove" },
                            {
                              confirmMessage: "このコメントを削除確定します。よろしいですか？",
                              onSuccess: () => setData((d) => (d ? { ...d, cases: d.cases.filter((x) => x.id !== c.id) } : d)),
                            },
                          )
                        }
                      >
                        削除確定
                      </ActionButton>
                      <ActionButton
                        variant="success"
                        disabled={busy === c.id}
                        onClick={() =>
                          postJson(
                            c.id,
                            `/api/admin/moderation-cases/${c.id}`,
                            { action: "restore" },
                            { onSuccess: () => setData((d) => (d ? { ...d, cases: d.cases.filter((x) => x.id !== c.id) } : d)) },
                          )
                        }
                      >
                        問題なし（復帰）
                      </ActionButton>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {data.openReports.length > 0 && (
        <Section id="section-open-reports">
          <SectionTitle>未処理コメント通報（参考） （{data.openReports.length}件）</SectionTitle>
          <p className="mb-3 text-xs text-ink-muted">
            3件以上で自動処理されます。人間キューに載っていない通報の一覧です。
          </p>
          <ul className="space-y-3">
            {data.openReports.map((r) => (
              <li key={r.id} className="rounded border border-border p-3 text-sm">
                <Link
                  href={`/issues/${r.comment.issue.slug}`}
                  className="font-medium underline"
                  target="_blank"
                >
                  {r.comment.issue.title}
                </Link>
                <p className="mt-1 line-clamp-2 text-ink-muted">{r.comment.body}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {r.reason || "理由なし"} — {r.reporter.email ?? r.reporter.name}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.heldRadar.length > 0 && (
        <Section id="section-held">
          <SectionTitle>Radar HELD（人間確認待ち候補） （{data.heldRadar.length}件）</SectionTitle>
          <HeldReasonSummary
            items={data.heldRadar}
            activeFilter={heldFilter}
            onFilterChange={setHeldFilter}
          />
          {(() => {
            const filtered = heldFilter
              ? data.heldRadar.filter((c) => describeHeldReason(c.decision).label === heldFilter)
              : data.heldRadar;
            if (filtered.length === 0) {
              return <p className="text-sm text-ink-muted">この理由に該当する候補はありません</p>;
            }
            return (
              <ul className="space-y-3">
                {filtered.map((c) => {
                  const reason = describeHeldReason(c.decision);
                  return (
                    <li key={c.id} className="rounded border border-border p-3">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-ink">{c.title}</p>
                        <HeldReasonBadge tone={reason.tone} label={reason.label} />
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        {c.classification} · {c.riskFlags.join(", ") || "—"}
                      </p>
                      {c.decision && (
                        <p className="mt-1 font-mono text-xs text-ink-faint">{c.decision}</p>
                      )}
                      <div className="mt-2 flex gap-2">
                        <ActionButton
                          variant="success"
                          disabled={busy === c.id}
                          onClick={() =>
                            postJson(
                              c.id,
                              `/api/admin/radar/${c.id}`,
                              { action: "approve" },
                              {
                                confirmMessage: reason.requiresHumanReview
                                  ? `「${c.title}」を承認して公開します（保留理由: ${reason.label}）。よろしいですか？`
                                  : undefined,
                                onSuccess: () =>
                                  setData((d) =>
                                    d ? { ...d, heldRadar: d.heldRadar.filter((x) => x.id !== c.id) } : d,
                                  ),
                              },
                            )
                          }
                        >
                          承認して公開
                        </ActionButton>
                        <ActionButton
                          variant="danger"
                          disabled={busy === c.id}
                          onClick={() =>
                            postJson(
                              c.id,
                              `/api/admin/radar/${c.id}`,
                              { action: "reject" },
                              {
                                onSuccess: () =>
                                  setData((d) =>
                                    d ? { ...d, heldRadar: d.heldRadar.filter((x) => x.id !== c.id) } : d,
                                  ),
                              },
                            )
                          }
                        >
                          却下（公開しない）
                        </ActionButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </Section>
      )}

      <div className="text-center">
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="text-sm text-ink-muted underline hover:text-ink"
        >
          再読み込み
        </button>
      </div>
    </PageContainer>
  );
}
