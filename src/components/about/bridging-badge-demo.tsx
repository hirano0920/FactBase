/**
 * 越境評価（bridging）— 並び順が「反対側からも参考になったと言われた数」で決まることの見た目。
 * 中立（まだ立場を決めていない人）からの評価が最も重い。
 */
export function BridgingBadgeDemo() {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-6 sm:px-6">
      <div className="rounded-xl border border-for/30 bg-for-muted/50 p-3">
        <p className="mb-1 text-[11px] font-extrabold tracking-wide text-for">賛成派のコメント</p>
        <p className="text-xs leading-relaxed text-ink-secondary">
          「一次情報や複数媒体の報道が揃っている点は評価できる」
        </p>
      </div>

      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent">
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden>
            <path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16ZM6.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-7 4.5a4.5 4.5 0 0 0 7 0H6.5Z" />
          </svg>
          反対派+2
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
          <svg viewBox="0 0 20 20" className="h-3 w-3" fill="currentColor" aria-hidden>
            <path d="M9 6.75V.75l5.25 5.25L9 12.75V6.75Z" />
            <path d="M4.5 18h9a.75.75 0 0 0 .75-.75V8.25a.75.75 0 0 0-.75-.75h-9a.75.75 0 0 0-.75.75v9c0 .414.336.75.75.75Z" />
          </svg>
          中立+3
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        並び順を決めるのは「いいねの数」ではなく、
        <span className="font-semibold text-ink-muted">
          自分と異なる立場、特にまだ立場を決めていない中立の人から「参考になった」と言われた数
        </span>
        が最も重く評価されます。同調圏だけで盛り上がるコメントが上に来ない仕組みです。
      </p>
    </div>
  );
}
