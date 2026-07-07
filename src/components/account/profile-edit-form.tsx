"use client";

import { useCallback, useState } from "react";
import { BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from "@/lib/constants";
import { Button } from "@/components/ui/button";

interface ProfileEditFormProps {
  initialName: string;
  initialBio: string;
}

export function ProfileEditForm({ initialName, initialBio }: ProfileEditFormProps) {
  const [name, setName] = useState(initialName);
  const [bio, setBio] = useState(initialBio);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useCallback(async () => {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, bio }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(data.error?.message ?? "保存に失敗しました");
        return;
      }
      setSaved(true);
    } catch {
      setError("通信に失敗しました。接続を確認してお試しください");
    } finally {
      setPending(false);
    }
  }, [name, bio]);

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-ink-muted">
        プロフィールは最初から公開です。コメントを重ねるほど tier が上がり、名前の横に表示されます。
      </p>

      <div>
        <label htmlFor="display-name" className="mb-1.5 block text-xs font-bold text-ink-secondary">
          表示名
        </label>
        <input
          id="display-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
      </div>

      <div>
        <label htmlFor="bio" className="mb-1.5 block text-xs font-bold text-ink-secondary">
          一言（公開プロフィールに表示）
        </label>
        <input
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={BIO_MAX_LENGTH}
          placeholder="例: 経済ニュースをウォッチしています"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
        />
        <p className="mt-1 text-right text-xs text-ink-faint tabular-nums">
          {bio.length} / {BIO_MAX_LENGTH}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" size="sm" disabled={pending || name.trim().length === 0} onClick={save}>
          {pending ? "保存中…" : "保存する"}
        </Button>
        {saved && <span className="text-sm font-semibold text-for">✓ 保存しました</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-against">
          {error}
        </p>
      )}
    </div>
  );
}
