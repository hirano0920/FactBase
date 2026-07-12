"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const LG_BREAKPOINT = 1024;
const BOTTOM_MARGIN = 16;
// ヘッダー直下までスクロールしてから bottom-pin する（ページ読み込み直後は通常フロー）
const TOP_CATCH_THRESHOLD = 80;

/** フッター（灰色の帯）に固定サイドバーが重ならないよう、フッターが見え始めた分だけ底上げする */
function getBottomOffset(): number {
  const footer = document.querySelector("footer");
  if (!footer) return BOTTOM_MARGIN;
  const footerTop = footer.getBoundingClientRect().top;
  const overlap = Math.max(0, window.innerHeight - footerTop);
  return BOTTOM_MARGIN + overlap;
}

/**
 * 右カラム用。ページスクロールに追従し、十分スクロールしてサイドバー全体が
 * 画面内に収まる状態になったら下端で固定する。portal は使わず子の再マウントを防ぐ。
 */
export function StickySidebar({ children }: { children: ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const naturalHeightRef = useRef(0);
  const pinnedRef = useRef(false);
  const [layout, setLayout] = useState<{
    pinned: boolean;
    spacerHeight?: number;
    fixed?: Pick<CSSProperties, "left" | "width" | "bottom">;
  }>({ pinned: false });

  useEffect(() => {
    const update = () => {
      const wrapper = wrapperRef.current;
      const inner = innerRef.current;
      if (!wrapper || !inner) return;

      if (window.innerWidth < LG_BREAKPOINT || wrapper.getBoundingClientRect().width === 0) {
        naturalHeightRef.current = 0;
        pinnedRef.current = false;
        setLayout({ pinned: false });
        return;
      }

      if (!pinnedRef.current && inner.offsetHeight > 0) {
        naturalHeightRef.current = inner.offsetHeight;
      }

      const height = naturalHeightRef.current || inner.offsetHeight;
      const wrapperRect = wrapper.getBoundingClientRect();
      const bottomOffset = getBottomOffset();
      const stickLine = window.innerHeight - bottomOffset;
      const naturalBottom = wrapperRect.top + height;
      const fitsInViewport = naturalBottom <= stickLine;
      const hasScrolledEnough = wrapperRect.top < TOP_CATCH_THRESHOLD;
      const shouldPin = fitsInViewport && hasScrolledEnough;

      if (shouldPin !== pinnedRef.current) {
        pinnedRef.current = shouldPin;
        if (shouldPin) {
          setLayout({
            pinned: true,
            spacerHeight: height,
            fixed: {
              left: wrapperRect.left,
              width: wrapperRect.width,
              bottom: bottomOffset,
            },
          });
        } else {
          naturalHeightRef.current = inner.offsetHeight;
          setLayout({ pinned: false });
        }
        return;
      }

      if (shouldPin) {
        setLayout((prev) => {
          if (!prev.pinned || !prev.fixed) return prev;
          if (
            prev.fixed.left === wrapperRect.left &&
            prev.fixed.width === wrapperRect.width &&
            prev.fixed.bottom === bottomOffset
          ) {
            return prev;
          }
          return {
            pinned: true,
            spacerHeight: height,
            fixed: {
              left: wrapperRect.left,
              width: wrapperRect.width,
              bottom: bottomOffset,
            },
          };
        });
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

  const fixedStyle: CSSProperties | undefined = layout.pinned
    ? {
        position: "fixed",
        bottom: layout.fixed?.bottom,
        left: layout.fixed?.left,
        width: layout.fixed?.width,
      }
    : undefined;

  return (
    <div
      ref={wrapperRef}
      className="self-start"
      style={layout.pinned ? { height: layout.spacerHeight } : undefined}
    >
      <div ref={innerRef} style={fixedStyle}>
        {children}
      </div>
    </div>
  );
}
