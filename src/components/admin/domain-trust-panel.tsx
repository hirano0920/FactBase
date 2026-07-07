"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageContainer, Section, SectionTitle } from "@/components/layout/page-container";

interface DomainTrustRule {
  id: string;
  hostname: string;
  action: string;
  note: string | null;
  createdAt: string;
}

export function DomainTrustPanel() {
  const [rules, setRules] = useState<DomainTrustRule[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hostname, setHostname] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/domain-trust");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      setRules(j.rules);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!hostname.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/domain-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname, note }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      setHostname("");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "追加に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/domain-trust?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer width="content" className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold text-ink">ドメイン信頼度フィルタ</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Tavily発見結果から除外する追加ドメインを管理します（コード内固定denylistを補完・デプロイ不要で反映）。
          <Link href="/admin" className="ml-2 text-link underline">
            管理ダッシュボードに戻る →
          </Link>
        </p>
        {error && (
          <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
      </header>

      <Section>
        <SectionTitle>ドメインを追加</SectionTitle>
        <form onSubmit={addRule} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs font-semibold text-ink-muted">ドメイン</label>
            <input
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="example.com"
              className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs font-semibold text-ink-muted">メモ（任意）</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="除外理由"
              className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !hostname.trim()}
            className="rounded-md border border-border bg-surface-raised px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface-muted disabled:opacity-50"
          >
            追加
          </button>
        </form>
        <p className="mt-2 text-xs text-ink-faint">
          サブドメインも自動的に含まれます（例: example.comを追加するとsub.example.comも除外）。
        </p>
      </Section>

      <Section>
        <SectionTitle>登録済みドメイン（{rules?.length ?? 0}件）</SectionTitle>
        {loading && !rules ? (
          <p className="text-sm text-ink-muted">読み込み中…</p>
        ) : !rules || rules.length === 0 ? (
          <p className="text-sm text-ink-muted">追加拒否リストは空です（コード内固定denylistのみで運用中）</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <span className="font-mono text-sm font-semibold text-ink">{r.hostname}</span>
                  {r.note && <span className="ml-2 text-xs text-ink-muted">{r.note}</span>}
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {new Date(r.createdAt).toLocaleString("ja-JP")} 追加
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeRule(r.id)}
                  className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-100 disabled:opacity-50"
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageContainer>
  );
}
