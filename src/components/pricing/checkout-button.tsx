"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

interface CheckoutButtonProps {
  plan: "COMMENT" | "FACTCHECK";
  isLoggedIn: boolean;
  isCurrent: boolean;
}

export function CheckoutButton({ plan, isLoggedIn, isCurrent }: CheckoutButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    if (!isLoggedIn) {
      window.location.href = "/login?redirect=/pricing&intent=checkout";
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as { url?: string; error?: { message: string } };
      if (!res.ok || !data.url) {
        setError(data.error?.message ?? "決済ページを開けませんでした。もう一度お試しください");
        setPending(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("通信に失敗しました。接続を確認してお試しください");
      setPending(false);
    }
  }, [isLoggedIn, plan]);

  if (isCurrent) {
    return (
      <Button variant="secondary" size="md" fullWidth disabled>
        現在のプラン
      </Button>
    );
  }

  return (
    <div>
      <Button variant="primary" size="md" fullWidth disabled={pending} onClick={handleClick}>
        {pending ? "手続き中…" : "3日間無料で試す"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-against">
          {error}
        </p>
      )}
    </div>
  );
}
