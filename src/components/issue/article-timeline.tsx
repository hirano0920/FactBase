"use client";

import { useEffect, useRef, useState } from "react";
import { extractListItems, parseTimelineItem } from "@/lib/article-sections";
import { cn } from "@/lib/utils";

interface ArticleTimelineProps {
  bodyHtml: string;
}

/**
 * 「これまでの流れ」用の縦タイムライン。
 * スクロール進入で線が伸び、各ノードが順に浮かび上がる。
 */
export function ArticleTimeline({ bodyHtml }: ArticleTimelineProps) {
  const items = extractListItems(bodyHtml).map(parseTimelineItem);
  const rootRef = useRef<HTMLOListElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (items.length === 0) {
    return <div className="prose-article" dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
  }

  return (
    <ol
      ref={rootRef}
      className={cn("article-timeline", visible && "article-timeline--visible")}
      aria-label="これまでの流れ"
    >
      <span className="article-timeline__rail" aria-hidden="true" />
      {items.map((item, i) => (
        <li
          key={i}
          className="article-timeline__item"
          style={{ ["--tl-i" as string]: String(i) }}
        >
          <span className="article-timeline__dot" aria-hidden="true">
            <span className="article-timeline__dot-core" />
          </span>
          <div className="article-timeline__card">
            {item.date ? (
              <time className="article-timeline__date">{item.date}</time>
            ) : null}
            <p className="article-timeline__body">{item.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
