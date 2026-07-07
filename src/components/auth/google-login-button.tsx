"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

/** Auth.js v5 は CSRF 付き POST が必要。直リンク GET は動かない */
export function GoogleLoginButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      await signIn("google", { callbackUrl: "/" });
    } catch {
      setError("ログインを開始できませんでした。しばらくしてからお試しください。");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="w-full rounded-md border border-border bg-white px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-muted disabled:opacity-60"
      >
        {loading ? "Google に接続中…" : "Google でログイン"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-against">
          {error}
        </p>
      )}
    </div>
  );
}
