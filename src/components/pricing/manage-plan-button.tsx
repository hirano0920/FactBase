"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

/** Stripeカスタマーポータルへ遷移（プラン変更・解約・請求履歴） */
export function ManagePlanButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: { message: string } };
      if (!res.ok || !data.url) {
        setError(data.error?.message ?? "プラン管理ページを開けませんでした");
        setPending(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("通信に失敗しました。接続を確認してお試しください");
      setPending(false);
    }
  }, []);

  return (
    <div className="text-center">
      <Button variant="secondary" size="sm" disabled={pending} onClick={handleClick}>
        {pending ? "読み込み中…" : "プラン管理（変更・解約）"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-against">
          {error}
        </p>
      )}
    </div>
  );
}
