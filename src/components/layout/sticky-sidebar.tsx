"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const LG_BREAKPOINT = 1024;
const BOTTOM_MARGIN = 16;

/**
 * サイドバーをページスクロールに追従させ、下端がビューポート底に達したら
 * そこで固定する（bottom sticky）。portal は使わず同一 DOM ツリー内で
 * position:fixed を切り替え、子の再マウントを防ぐ。
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
      const stickLine = window.innerHeight - BOTTOM_MARGIN;
      const fitsInViewport = height + BOTTOM_MARGIN < window.innerHeight;
      const naturalBottom = wrapperRect.top + height;
      const shouldPin = fitsInViewport && naturalBottom >= stickLine;

      if (shouldPin !== pinnedRef.current) {
        pinnedRef.current = shouldPin;
        if (shouldPin) {
          setLayout({
            pinned: true,
            spacerHeight: height,
            fixed: {
              left: wrapperRect.left,
              width: wrapperRect.width,
              bottom: BOTTOM_MARGIN,
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
          if (prev.fixed.left === wrapperRect.left && prev.fixed.width === wrapperRect.width) {
            return prev;
          }
          return {
            pinned: true,
            spacerHeight: height,
            fixed: {
              left: wrapperRect.left,
              width: wrapperRect.width,
              bottom: BOTTOM_MARGIN,
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
