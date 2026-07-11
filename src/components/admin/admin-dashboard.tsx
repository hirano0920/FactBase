"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageContainer, Section, SectionTitle } from "@/components/layout/page-container";

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

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4 text-center shadow-card">
      <div className="text-2xl font-extrabold text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
    </div>
  );
}

export function AdminDashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  async function postJson(url: string, body: object) {
    setBusy(url);
    setToast(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      setToast("完了しました");
      await load();
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
        <CountCard label="モデレーション待ち" value={data.counts.pendingCases} />
        <CountCard label="争点・品質確認" value={data.counts.underReviewIssues} />
        <CountCard label="Radar HELD" value={data.counts.heldRadar} />
        <CountCard label="未処理通報" value={data.counts.openReports} />
      </div>

      <Section>
        <SectionTitle>Radar 自動公開争点（ワンタップ非公開）</SectionTitle>
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
                      disabled={!!busy}
                      onClick={() =>
                        postJson(`/api/admin/issues/${issue.slug}`, { action: "unpublish" })
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

      <Section>
        <SectionTitle>品質報告 — 確認待ち争点</SectionTitle>
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
                    disabled={!!busy}
                    onClick={() => postJson(`/api/admin/issues/${issue.slug}`, { action: "clear" })}
                  >
                    問題なし（公開継続）
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    disabled={!!busy}
                    onClick={() => postJson(`/api/admin/issues/${issue.slug}`, { action: "archive" })}
                  >
                    品質不良で非公開
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section>
        <SectionTitle>コメント — 通報・異議申立キュー</SectionTitle>
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
                        disabled={!!busy}
                        onClick={() =>
                          postJson(`/api/admin/moderation-cases/${c.id}`, {
                            action: "accept-appeal",
                          })
                        }
                      >
                        異議認容（復帰）
                      </ActionButton>
                      <ActionButton
                        variant="danger"
                        disabled={!!busy}
                        onClick={() =>
                          postJson(`/api/admin/moderation-cases/${c.id}`, {
                            action: "reject-appeal",
                          })
                        }
                      >
                        異議棄却
                      </ActionButton>
                    </>
                  ) : (
                    <>
                      <ActionButton
                        variant="danger"
                        disabled={!!busy}
                        onClick={() =>
                          postJson(`/api/admin/moderation-cases/${c.id}`, { action: "remove" })
                        }
                      >
                        削除確定
                      </ActionButton>
                      <ActionButton
                        variant="success"
                        disabled={!!busy}
                        onClick={() =>
                          postJson(`/api/admin/moderation-cases/${c.id}`, { action: "restore" })
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
        <Section>
          <SectionTitle>未処理コメント通報（参考）</SectionTitle>
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
        <Section>
          <SectionTitle>Radar HELD（人間確認待ち候補）</SectionTitle>
          <ul className="space-y-3">
            {data.heldRadar.map((c) => (
              <li key={c.id} className="rounded border border-border p-3">
                <p className="font-medium text-ink">{c.title}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {c.classification} · {c.riskFlags.join(", ") || "—"}
                </p>
                {c.decision && (
                  <p className="mt-1 font-mono text-xs text-ink-faint">{c.decision}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <ActionButton
                    variant="success"
                    disabled={!!busy}
                    onClick={() => postJson(`/api/admin/radar/${c.id}`, { action: "approve" })}
                  >
                    承認して公開
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    disabled={!!busy}
                    onClick={() => postJson(`/api/admin/radar/${c.id}`, { action: "reject" })}
                  >
                    却下（公開しない）
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
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
