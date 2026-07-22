"use client";

import { useState } from "react";
import type { IssueVideo } from "@/types";

/**
 * 討論動画のYouTube埋め込み（アベプラ等が元ネタの争点のみ）。
 * iframe埋め込みはYouTube利用規約で明示許可されている範囲のみ使用（スクショ・転載はしない）。
 * クリックするまでiframeを読み込まないfacade方式:
 * - 初期表示はサムネイル画像（YouTube公式CDN）だけなので記事ページのLCPを壊さない
 * - 再生時はプライバシー強化モード（youtube-nocookie.com）で読み込む
 */
export function VideoEmbed({ video }: { video: IssueVideo }) {
  const [playing, setPlaying] = useState(false);

  if (video.provider !== "youtube") return null;

  return (
    <figure>
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
        {playing ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 h-full w-full"
            aria-label={`動画を再生: ${video.title}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- YouTube公式CDNの動画サムネイル。next/imageの最適化対象外 */}
            <img
              src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`}
              alt=""
              className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
              loading="lazy"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/70 transition-transform group-hover:scale-110">
                <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8 fill-white" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          </button>
        )}
      </div>
      <figcaption className="mt-2 text-xs text-ink-soft">
        📺 出典:{" "}
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-border underline-offset-2 hover:text-ink"
        >
          {video.channel}「{video.title}」
        </a>
        （YouTubeで見る）
      </figcaption>
    </figure>
  );
}
