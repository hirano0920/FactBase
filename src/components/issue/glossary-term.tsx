"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GlossaryTerm as GlossaryTermData } from "@/types";

interface GlossaryTermProps {
  data: GlossaryTermData;
  children: React.ReactNode;
}

/**
 * 難語に点線の下線を引き、ホバー/タップで簡潔な説明を吹き出しで出す。
 * 吹き出しはposition:fixedでdocument.bodyにポータルし、対象語の位置を
 * getBoundingClientRectで計算して置く（親要素のoverflow:hiddenに切られないため）。
 */
export function GlossaryTermInline({ data, children }: GlossaryTermProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<{ top: number; left: number; placeAbove: boolean; arrowX: number } | null>(
    null,
  );
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reposition = () => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;
    const r = anchor.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const vw = window.innerWidth;
    let left = r.left + r.width / 2 - popRect.width / 2;
    left = Math.max(12, Math.min(left, vw - popRect.width - 12));
    const placeAbove = r.top >= 140;
    const top = placeAbove ? r.top - popRect.height - 10 : r.bottom + 10;
    const arrowX = Math.max(14, Math.min(r.left + r.width / 2 - left - 5, popRect.width - 24));
    setStyle({ top, left, placeAbove, arrowX });
  };

  useEffect(() => {
    if (!open) return;
    reposition();
    const onScroll = () => reposition();
    const onResize = () => reposition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setOpen(true);
  };
  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="cursor-help border-b-[1.5px] border-dotted border-glossary-underline text-inherit hover:rounded hover:bg-glossary-muted focus-visible:rounded focus-visible:bg-glossary-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-glossary"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {children}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            onMouseEnter={() => hideTimer.current && clearTimeout(hideTimer.current)}
            onMouseLeave={scheduleHide}
            className="fixed z-50 max-w-[280px] rounded-2xl border border-glossary-border bg-surface px-3.5 py-3 text-left shadow-lg"
            style={{
              top: style?.top ?? -9999,
              left: style?.left ?? -9999,
              visibility: style ? "visible" : "hidden",
            }}
          >
            <span
              aria-hidden="true"
              className="absolute h-2.5 w-2.5 border-glossary-border bg-surface"
              style={
                style?.placeAbove
                  ? {
                      bottom: "-5px",
                      left: style.arrowX,
                      borderRight: "1px solid",
                      borderBottom: "1px solid",
                      transform: "rotate(45deg)",
                    }
                  : {
                      top: "-5px",
                      left: style?.arrowX ?? 0,
                      borderLeft: "1px solid",
                      borderTop: "1px solid",
                      transform: "rotate(45deg)",
                    }
              }
            />
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-glossary">
              <span className="h-1.5 w-1.5 rounded-full bg-glossary-underline" aria-hidden="true" />
              {data.term}
            </p>
            <p className="text-[13px] leading-relaxed text-ink-secondary">{data.def}</p>
            <p className="mt-2 flex items-center gap-1 text-[10.5px] text-ink-faint">
              {data.source === "wikipedia" ? (
                <>
                  📖{" "}
                  <a
                    href={data.wikipediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Wikipediaより要約
                  </a>
                </>
              ) : (
                "✨ AIによる簡潔な要約"
              )}
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
