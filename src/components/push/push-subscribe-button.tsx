"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";

/**
 * プッシュ通知の購読トグル。
 * - Service Worker登録は初回マウント時に行う（sw.jsは通知専用でキャッシュはしない）
 * - VAPID公開鍵は NEXT_PUBLIC_VAPID_PUBLIC_KEY から取る（未設定ならボタン自体を出さない）
 * - 通知権限はユーザーがボタンを押した時だけ要求する（ページ表示と同時のpermission要求はブロック率が高い）
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type Status = "unsupported" | "idle" | "subscribed" | "working";

export function PushSubscribeButton() {
  const [status, setStatus] = useState<Status>("unsupported");
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!vapidKey || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? "subscribed" : "idle");
      } catch {
        // SW登録失敗時はボタンを出さない
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidKey]);

  const subscribe = useCallback(async () => {
    if (!vapidKey) return;
    setStatus("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("idle");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
      const json = sub.toJSON();
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys }),
      });
      setStatus("subscribed");
    } catch {
      setStatus("idle");
    }
  }, [vapidKey]);

  const unsubscribe = useCallback(async () => {
    setStatus("working");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("idle");
    } catch {
      setStatus("subscribed");
    }
  }, []);

  if (status === "unsupported") return null;

  if (status === "subscribed") {
    return (
      <button
        type="button"
        onClick={unsubscribe}
        className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink-secondary transition-colors hover:bg-surface-muted"
      >
        <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
        通知オフ
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={status === "working"}
      onClick={subscribe}
      className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs font-bold text-accent transition-colors hover:bg-accent-soft/70 disabled:opacity-50"
    >
      <Bell className="h-3.5 w-3.5" aria-hidden="true" />
      朝の争点を通知で受け取る
    </button>
  );
}
