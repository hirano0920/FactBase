/** サイドバーの Suspense フォールバック。本文より先にメインを描画するため。 */
export function SidebarSkeleton() {
  return (
    <aside className="space-y-4 animate-pulse" aria-hidden>
      <div className="h-48 rounded-xl border border-border bg-surface-muted" />
      <div className="h-36 rounded-xl border border-border bg-surface-muted" />
      <div className="h-28 rounded-xl border border-border bg-surface-muted" />
    </aside>
  );
}
