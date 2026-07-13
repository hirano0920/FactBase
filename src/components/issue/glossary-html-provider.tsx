"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GlossaryTerm } from "@/types";

interface GlossaryHtmlProviderProps {
  glossary: GlossaryTerm[];
  children: React.ReactNode;
}

/**
 * injectGlossarySpans（glossary-html.ts）でHTML側に埋め込んだ
 * <span class="js-glossary-term" data-glossary-term="…">をイベント委譲で拾い、
 * ホバー/タップで吹き出しを出す。dangerouslySetInnerHTMLで注入した生HTMLは
 * Reactコンポーネントではないため、個別にオンハンドラを付けられない → 親でまとめて拾う。
 */
export function GlossaryHtmlProvider({ glossary, children }: GlossaryHtmlProviderProps) {
  const [active, setActive] = useState<{ term: GlossaryTerm; rect: DOMRect } | null>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number; placeAbove: boolean; arrowX: number } | null>(
    null,
  );
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const findTermEl = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>(".js-glossary-term");
  };

  const position = (rect: DOMRect) => {
    const popover = popoverRef.current;
    if (!popover) return;
    const popRect = popover.getBoundingClientRect();
    const vw = window.innerWidth;
    let left = rect.left + rect.width / 2 - popRect.width / 2;
    left = Math.max(12, Math.min(left, vw - popRect.width - 12));
    const placeAbove = rect.top >= 140;
    const top = placeAbove ? rect.top - popRect.height - 10 : rect.bottom + 10;
    const arrowX = Math.max(14, Math.min(rect.left + rect.width / 2 - left - 5, popRect.width - 24));
    setPlacement({ top, left, placeAbove, arrowX });
  };

  const show = (el: HTMLElement) => {
    const key = el.dataset.glossaryTerm;
    const term = glossary.find((t) => t.matchText === key);
    if (!term) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const rect = el.getBoundingClientRect();
    setActive({ term, rect });
    requestAnimationFrame(() => position(rect));
  };

  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(null), 150);
  };

  return (
    <div
      onMouseOver={(e) => {
        const el = findTermEl(e.target);
        if (el) show(el);
      }}
      onMouseOut={(e) => {
        const el = findTermEl(e.target);
        if (el) scheduleHide();
      }}
      onFocus={(e) => {
        const el = findTermEl(e.target);
        if (el) show(el);
      }}
      onBlur={(e) => {
        const el = findTermEl(e.target);
        if (el) scheduleHide();
      }}
      onClick={(e) => {
        const el = findTermEl(e.target);
        if (!el) return;
        e.preventDefault();
        if (active?.term.matchText === el.dataset.glossaryTerm) {
          setActive(null);
        } else {
          show(el);
        }
      }}
    >
      {children}
      {active &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            onMouseEnter={() => hideTimer.current && clearTimeout(hideTimer.current)}
            onMouseLeave={scheduleHide}
            className="fixed z-50 max-w-[280px] rounded-2xl border border-glossary-border bg-surface px-3.5 py-3 text-left shadow-lg"
            style={{
              top: placement?.top ?? -9999,
              left: placement?.left ?? -9999,
              visibility: placement ? "visible" : "hidden",
            }}
          >
            <span
              aria-hidden="true"
              className="absolute h-2.5 w-2.5 border-glossary-border bg-surface"
              style={
                placement?.placeAbove
                  ? {
                      bottom: "-5px",
                      left: placement.arrowX,
                      borderRight: "1px solid",
                      borderBottom: "1px solid",
                      transform: "rotate(45deg)",
                    }
                  : {
                      top: "-5px",
                      left: placement?.arrowX ?? 0,
                      borderLeft: "1px solid",
                      borderTop: "1px solid",
                      transform: "rotate(45deg)",
                    }
              }
            />
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-glossary">
              <span className="h-1.5 w-1.5 rounded-full bg-glossary-underline" aria-hidden="true" />
              {active.term.term}
            </p>
            <p className="text-[13px] leading-relaxed text-ink-secondary">{active.term.def}</p>
            <p className="mt-2 flex items-center gap-1 text-[10.5px] text-ink-faint">
              {active.term.source === "wikipedia" ? (
                <>
                  📖{" "}
                  <a
                    href={active.term.wikipediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link hover:underline"
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
    </div>
  );
}
