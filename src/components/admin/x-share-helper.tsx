"use client";

import { useState } from "react";
import { SITE } from "@/lib/constants";

interface XShareIssue {
  slug: string;
  title: string;
}

interface XShareHelperProps {
  issues: XShareIssue[];
}

function buildCaption(issue: XShareIssue): string {
  return `【${issue.title}】\n\n賛成 / 反対 / わからない — 両側の意見が見える討論会場\n\n${SITE.url}/issues/${issue.slug}\n\n#TwoSides`;
}

/** Phase 6 — X 手動投稿支援（キルスイッチ付き運用の補助） */
export function XShareHelper({ issues }: XShareHelperProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (issues.length === 0) return null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        良さそうな争点だけ手動で X に投稿。キャプションとリンクをコピーして使ってください（自動投稿は品質確認後）。
      </p>
      {issues.slice(0, 5).map((issue) => {
        const url = `${SITE.url}/issues/${issue.slug}`;
        const caption = buildCaption(issue);
        return (
          <div key={issue.slug} className="rounded-lg border border-border bg-surface-raised p-3 text-sm">
            <p className="font-medium text-ink">{issue.title}</p>
            <p className="mt-1 truncate text-xs text-ink-faint">{url}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copy(url, `url-${issue.slug}`)}
                className="rounded border border-border px-2 py-1 text-xs font-semibold hover:bg-surface-muted"
              >
                {copied === `url-${issue.slug}` ? "✓ URL" : "URLコピー"}
              </button>
              <button
                type="button"
                onClick={() => copy(caption, `cap-${issue.slug}`)}
                className="rounded border border-for/40 bg-for-muted px-2 py-1 text-xs font-semibold text-for hover:opacity-90"
              >
                {copied === `cap-${issue.slug}` ? "✓ キャプション" : "キャプションコピー"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
