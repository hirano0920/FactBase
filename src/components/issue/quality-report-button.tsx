"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

interface QualityReportButtonProps {
  slug: string;
  isLoggedIn: boolean;
}

interface ApiErrorBody {
  error?: { message?: string };
}

/**
 * 「この要約はおかしい」ボタン。Radar自動生成争点にのみ表示する。
 * 理由の記入を求める（空欄の報告はAI裏取りで信頼度が下がる設計のため）。
 */
export function QualityReportButton({ slug, isLoggedIn }: QualityReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(() => {
    if (!isLoggedIn) {
      window.location.href = "/login";
      return;
    }
    setOpen(true);
  }, [isLoggedIn]);

  const handleSubmit = useCallback(async () => {
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`/api/issues/${slug}/quality-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
        setError(data.error?.message ?? "報告に失敗しました");
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError("通信に失敗しました。接続を確認してお試しください");
      setState("idle");
    }
  }, [reason, slug]);

  if (state === "sent") {
    return <p className="text-xs text-ink-faint">報告を受け付けました。ご協力ありがとうございます</p>;
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={handleOpen} className="text-ink-faint">
        この要約はおかしい・的外れだと報告する
      </Button>
    );
  }

  return (
    <div className="mx-auto max-w-sm rounded-md border border-border bg-surface-muted p-3 text-left">
      <label htmlFor="quality-reason" className="mb-1 block text-xs text-ink-secondary">
        どこがおかしいか具体的に教えてください（任意ですが、理由があるほど確認が早くなります）
      </label>
      <textarea
        id="quality-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        rows={2}
        placeholder="例: 無関係な2つの出来事が1つの争点として混ざっている"
        className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={state === "sending"}>
          キャンセル
        </Button>
        <Button variant="secondary" size="sm" onClick={handleSubmit} disabled={state === "sending"}>
          {state === "sending" ? "送信中…" : "報告する"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-against">
          {error}
        </p>
      )}
    </div>
  );
}
