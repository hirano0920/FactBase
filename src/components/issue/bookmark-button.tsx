"use client";

import { useCallback, useState } from "react";
import { BookmarkIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface BookmarkButtonProps {
  slug: string;
  initialBookmarked: boolean;
  isLoggedIn: boolean;
}

export function BookmarkButton({ slug, initialBookmarked, isLoggedIn }: BookmarkButtonProps) {
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [pending, setPending] = useState(false);

  const toggle = useCallback(async () => {
    if (!isLoggedIn) {
      window.location.href = "/login";
      return;
    }
    if (pending) return;
    setPending(true);
    const next = !bookmarked;
    setBookmarked(next); // 楽観的更新。保存操作は失敗しても実害が小さいため
    try {
      const res = await fetch(`/api/issues/${slug}/bookmark`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) setBookmarked(!next);
    } catch {
      setBookmarked(!next);
    } finally {
      setPending(false);
    }
  }, [bookmarked, isLoggedIn, pending, slug]);

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? "保存を解除" : "スレッドを保存"}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full transition",
        bookmarked ? "text-warm" : "text-ink-faint hover:bg-surface-muted hover:text-ink-secondary",
      )}
    >
      <BookmarkIcon
        style={{ width: 17, height: 17 }}
        fill={bookmarked ? "currentColor" : "none"}
      />
    </button>
  );
}
