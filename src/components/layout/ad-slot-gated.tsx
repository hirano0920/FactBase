"use client";

import { useEffect, useState } from "react";
import { AdSlot } from "@/components/layout/page-container";
import { planShowsAds } from "@/lib/plan-features";
import { fetchIssueViewer, hasLikelySessionCookie } from "@/lib/issue-viewer-client";

interface AdSlotGatedProps {
  slug?: string;
  label?: string;
  className?: string;
}

/**
 * Pro ユーザーには広告を出さない。
 * slug があれば viewer API（IssueViewerProvider と共有キャッシュ）でプランを取得。
 * セッションcookieが無ければゲスト確定で fetch しない。
 */
export function AdSlotGated({ slug, label, className }: AdSlotGatedProps) {
  const [showAds, setShowAds] = useState(true);

  useEffect(() => {
    if (!slug) return;
    if (!hasLikelySessionCookie()) return;
    let cancelled = false;

    (async () => {
      try {
        const data = await fetchIssueViewer(slug);
        if (cancelled || !data.isLoggedIn) return;
        if (!cancelled) setShowAds(planShowsAds(data.plan));
      } catch {
        /* 広告表示のまま */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!showAds) return null;
  return <AdSlot label={label} className={className} />;
}
