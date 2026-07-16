/**
 * 難語ホバー用語集（実際は src/components/issue/glossary-term.tsx が本文中でホバー/タップ表示する）
 * の見た目を、紹介ページ用に「常時開いた状態」で静的に再現したもの。
 * 実コンポーネントは操作依存（hover/focus）のため、常に見えている紹介用の見た目を別途用意する。
 */
export function GlossaryDemo() {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-6 sm:px-6">
      <p className="text-sm leading-loose text-ink-secondary sm:text-base">
        日銀は会合で、
        <span className="relative inline-block border-b-[1.5px] border-dotted border-glossary-underline font-medium text-ink">
          乖離許容幅
        </span>
        の運用を見直すと発表した。
      </p>

      <div className="relative mt-4 max-w-xs rounded-2xl border border-glossary-border bg-surface-raised px-3.5 py-3 shadow-sm">
        <span
          aria-hidden
          className="absolute -top-[5px] left-6 h-2.5 w-2.5 rotate-45 border-l border-t border-glossary-border bg-surface-raised"
        />
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold text-glossary">
          <span className="h-1.5 w-1.5 rounded-full bg-glossary-underline" aria-hidden />
          乖離許容幅
        </p>
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          為替の変動を抑えるため、目標の水準との差にあらかじめ設定しておく許容範囲のこと。
        </p>
        <p className="mt-2 flex items-center gap-1 text-[10.5px] text-ink-faint">
          📖 <span className="text-link">Wikipediaより要約</span>
        </p>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        本文中の難しい専門用語にカーソルを合わせる（スマホはタップ）だけで、その場で意味が分かります。
      </p>
    </div>
  );
}
