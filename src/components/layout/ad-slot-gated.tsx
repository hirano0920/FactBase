"use client";

import { useEffect, useState } from "react";
import { AdSlot } from "@/components/layout/page-container";
import { planShowsAds } from "@/lib/plan-features";
import type { Plan } from "@prisma/client";

interface AdSlotGatedProps {
  slug?: string;
  label?: string;
  className?: string;
}

/**
 * Pro ユーザーには広告を出さない。slug があれば争点 viewer API でプランを取得。
 */
export function AdSlotGated({ slug, label, className }: AdSlotGatedProps) {
  const [showAds, setShowAds] = useState(true);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/issues/${encodeURIComponent(slug)}/viewer`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { isLoggedIn: boolean; plan?: Plan };
        if (!data.isLoggedIn) return;
        if (!cancelled) setShowAds(planShowsAds(data.plan ?? "FREE"));
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
