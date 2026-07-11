import type { ReactNode } from "react";

/**
 * サイドバーをヘッダー直下で追従させる。JS + portal による bottom-pin は
 * pin/unpin のたびに子が再マウントされ API 再取得やレイアウトのジャンプを招うため、
 * 標準の position:sticky に戻している（RouteTransition 側も transform 残留を避ける）。
 */
export function StickySidebar({ children }: { children: ReactNode }) {
  return (
    <div className="self-start lg:sticky lg:top-[4.75rem] lg:max-h-[calc(100dvh-5.75rem)] lg:overflow-y-auto">
      {children}
    </div>
  );
}
