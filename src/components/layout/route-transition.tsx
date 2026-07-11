"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * ルート(パス)が変わるたびにコンテンツをふわっとフェードインさせる。
 *
 * 以前は`key={pathname}`で強制的に子要素をアンマウント→再マウントしていたが、これだと
 * Next.jsが新ページの準備を待たずに旧ページを即座に消してしまい、新ページの描画が
 * 少しでも遅れると「一瞬何も見えない」空白が発生していた（＝ヒーローが一瞬見えて消える不具合）。
 * 今はNext.js側の「準備ができてから切り替える」挙動をそのまま活かし、
 * 切り替わった後にCSSアニメーションだけ再生し直す（アンマウントはしない）。
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    el.classList.remove("route-transition");
    void el.offsetWidth; // reflowを強制してアニメーションを再始動させる
    el.classList.add("route-transition");
  }, [pathname]);

  return (
    <div ref={ref} className="route-transition">
      {children}
    </div>
  );
}
