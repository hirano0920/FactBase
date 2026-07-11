"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface RebuttalAssistButtonProps {
  slug: string;
  commentId: string;
}

/** Plus/Pro — 争点素材から反論候補を3つ提示 */
export function RebuttalAssistButton({ slug, commentId }: RebuttalAssistButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cards, setCards] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchCards = async () => {
    setOpen(true);
    if (cards.length > 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/issues/${encodeURIComponent(slug)}/rebuttal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opponentCommentId: commentId }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j?.error?.message ?? "取得に失敗しました");
        return;
      }
      setCards(j.cards ?? []);
    } catch {
      setError("取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={fetchCards} className="text-xs text-accent">
        💡 反論候補
      </Button>
      {open && (
        <div className="mt-2 rounded-md border border-accent/25 bg-accent/5 px-3 py-2 text-sm">
          {loading && <p className="text-ink-muted">争点素材から反論候補を生成中…</p>}
          {error && <p className="text-against text-xs">{error}</p>}
          {!loading && cards.length > 0 && (
            <ul className="space-y-1.5">
              {cards.map((c, i) => (
                <li key={i} className="text-ink-secondary">
                  {i + 1}. {c}
                </li>
              ))}
            </ul>
          )}
          {!loading && !error && cards.length === 0 && (
            <p className="text-xs text-ink-muted">候補がありませんでした</p>
          )}
          <p className="mt-2 text-[10px] text-ink-faint">
            争点記事の素材のみ使用 · 人格攻撃NG · そのままコピーせず自分の言葉で
          </p>
        </div>
      )}
    </>
  );
}
