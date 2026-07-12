"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";
import { SearchIcon, XIcon, MessageCircleIcon } from "@/components/ui/icons";
import type { IssueSearchResult } from "@/lib/data";

const DEBOUNCE_MS = 300;

/** 一致箇所を<mark>でハイライトする。正規表現の特殊文字はエスケープして安全に扱う */
function highlightMatch(title: string, query: string) {
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return title;
  const parts = title.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.trim().toLowerCase() ? (
      <mark key={i} className="rounded-sm bg-accent-soft text-accent">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** 左カラム上部の記事検索。タイトル部分一致。ログイン不要。 */
export function IssueSearchBox() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IssueSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/issues/search?q=${encodeURIComponent(q)}`);
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { issues: IssueSearchResult[] };
        setResults(data.issues);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
          style={{ width: 16, height: 16 }}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="スレッドを検索"
          aria-label="スレッドを検索"
          className="w-full rounded-full border border-border bg-surface-raised py-2.5 pl-9 pr-9 text-sm text-ink outline-none transition-shadow focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="検索をクリア"
            className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-center text-ink-faint hover:text-ink"
          >
            <XIcon style={{ width: 14, height: 14 }} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-96 overflow-y-auto rounded-2xl border border-border bg-surface-raised shadow-card">
          {loading && <p className="p-4 text-xs text-ink-faint">検索中…</p>}

          {!loading && results.length === 0 && (
            <p className="p-4 text-xs text-ink-faint">一致するスレッドが見つかりません</p>
          )}

          {!loading && results.length > 0 && (
            <>
              <p className="px-4 pt-3 text-[11px] text-ink-faint">{results.length}件ヒット</p>
              <ul className="p-1.5">
                {results.map((issue) => (
                  <li key={issue.slug}>
                    <Link
                      href={`/issues/${issue.slug}`}
                      onClick={() => setOpen(false)}
                      className="block rounded-xl px-3 py-2.5 no-underline hover:bg-surface-muted"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-ink-faint">
                          {CATEGORIES.find((c) => c.id === issue.category)?.label ?? issue.category}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-ink-faint">
                          <MessageCircleIcon style={{ width: 11, height: 11 }} />
                          {formatNumber(issue.commentCount)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-ink-secondary">
                        {highlightMatch(issue.title, query)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
