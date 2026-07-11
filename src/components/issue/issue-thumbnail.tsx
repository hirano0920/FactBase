"use client";

import { useState } from "react";

interface IssueThumbnailProps {
  src: string | null;
  alt: string;
  sourceFeed?: string | null;
  /** カテゴリピルを画像左上に重ねる（案B: カテゴリを画像に統合し密度を上げる） */
  categoryLabel?: string;
  className?: string;
}

/**
 * 出典記事のog:imageをリンクプレビューとして表示するだけのサムネイル（案B: カテゴリ・出典を
 * 画像に重ねる密度重視レイアウト）。自前保存はせず<img src>で元URLを直接参照する。
 * ホットリンク拒否・読み込み失敗時はonErrorでフォールバックのプレースホルダーに切り替える
 * （壊れた画像アイコンは出さない・グリッドの高さは揃ったまま維持する）。
 */
export function IssueThumbnail({ src, alt, sourceFeed, categoryLabel, className }: IssueThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;

  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br from-accent-soft to-surface-muted ${className ?? ""}`}
    >
      {showImage ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent"
          />
        </>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tracking-[0.08em] text-ink-faint">
          TwoSides
        </span>
      )}

      {categoryLabel && (
        <span
          className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] ${
            showImage
              ? "bg-black/55 text-white backdrop-blur-sm"
              : "border border-border bg-surface/80 text-ink-muted"
          }`}
        >
          {categoryLabel}
        </span>
      )}
      {showImage && sourceFeed && (
        <span className="absolute bottom-1.5 right-2 text-[10px] font-medium text-white/85">{sourceFeed}</span>
      )}
    </div>
  );
}
