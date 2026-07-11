"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const LG_BREAKPOINT = 1024;
const BOTTOM_MARGIN = 16;
// ヘッダー直下あたりまで自然な位置がスクロールで上がってくるまでは固定しない。
// 短いコンテンツだと「下端に収まるから」という理由だけで、ページ読み込み直後・
// スクロール前から画面下部に張り付いて見えてしまう（対策なしだと不自然）ため、
// 「実際にスクロールして、上に隠れそうになったら初めて掴む」動きにする。
const TOP_CATCH_THRESHOLD = 80;

/**
 * サイドバーを「記事カードのスクロールに同期して流れるが、自身の内容が
 * 画面下端に達したらそこで留まる」ようにする。CSS単体の`position: sticky; bottom`は
 * このgridレイアウト内だと効かない（ブラウザのgrid内sticky-bottomの既知の制限）ため、
 * スクロール位置を見てfixed/staticを切り替えるJS実装にしている。
 *
 * pinned時はdocument.bodyへcreatePortalする。祖先に`transform`を持つ要素
 * （RouteTransitionのページ遷移アニメーション等）があると、position:fixedの基準点が
 * viewportでなくその祖先になってしまうため、portalで完全に外に出して回避する。
 */
export function StickySidebar({ children }: { children: ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const naturalHeightRef = useRef<number | null>(null);
  const [pinned, setPinned] = useState<{ bottom: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const update = () => {
      const el = wrapperRef.current;
      if (!el || window.innerWidth < LG_BREAKPOINT) {
        naturalHeightRef.current = null;
        setPinned(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      // 親から hidden（display:none）にされている場合は幅・高さが0になり、
      // 「もう画面下端を過ぎた」と誤判定してportalで飛び出してしまうため何もしない
      if (rect.width === 0) {
        naturalHeightRef.current = null;
        setPinned(null);
        return;
      }
      // 一度固定になると子がposition:fixedで高さに寄与しなくなるため、
      // まだ通常フローの時に測った高さを覚えておいてwrapperの崩れを防ぐ
      if (rect.height > 0) {
        naturalHeightRef.current = rect.height;
      }
      const naturalBottom = rect.top + (naturalHeightRef.current ?? rect.height);
      const wouldFitBelowThreshold = naturalBottom < window.innerHeight - BOTTOM_MARGIN;
      const hasScrolledCloseToTop = rect.top < TOP_CATCH_THRESHOLD;
      if (wouldFitBelowThreshold && hasScrolledCloseToTop) {
        setPinned({ bottom: BOTTOM_MARGIN, left: rect.left, width: rect.width });
      } else {
        setPinned(null);
      }
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const isPinned = pinned && mounted;

  return (
    <div
      ref={wrapperRef}
      className="self-start"
      style={isPinned ? { height: naturalHeightRef.current ?? undefined } : undefined}
    >
      {isPinned
        ? createPortal(
            <div
              style={{
                position: "fixed",
                bottom: pinned.bottom,
                left: pinned.left,
                width: pinned.width,
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : children}
    </div>
  );
}
