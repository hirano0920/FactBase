"use client";

import { useCallback, useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

/** 退会ボタン。誤操作防止のため確認テキストの入力を要求してから削除する。 */
export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const CONFIRM_WORD = "退会";

  const handleDelete = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(data.error?.message ?? "退会処理に失敗しました。もう一度お試しください");
        setPending(false);
        return;
      }
      await signOut({ redirectTo: "/" });
    } catch {
      setError("通信に失敗しました。接続を確認してお試しください");
      setPending(false);
    }
  }, []);

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-against">
        退会する
      </Button>
    );
  }

  return (
    <div className="max-w-sm rounded-md border border-against/30 bg-against-muted p-4">
      <p className="text-sm text-ink-secondary">
        退会するとアカウント・投票・コメント・称号がすべて削除され、元に戻せません。
        有料プランは自動的に解約されます。
      </p>
      <p className="mt-3 text-xs text-ink-muted">
        続けるには「{CONFIRM_WORD}」と入力してください
      </p>
      <input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-against"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={pending}>
          キャンセル
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={confirmText !== CONFIRM_WORD || pending}
          onClick={handleDelete}
          className="bg-against hover:opacity-90"
        >
          {pending ? "削除中…" : "完全に削除する"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-against">
          {error}
        </p>
      )}
    </div>
  );
}
