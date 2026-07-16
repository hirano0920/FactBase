/**
 * 「書くAI」と「採点するAI」を別モデルに分離している品質ゲート
 * （scripts/radar/lib/article-judge.ts が採点、radar-article.ts が執筆）の流れを図解したもの。
 */
export function AiJudgeDemo() {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-6 sm:px-6">
      <div className="flex items-center justify-center gap-2 sm:gap-3">
        <div className="flex-1 rounded-xl border border-border bg-surface-muted px-3 py-3 text-center">
          <p className="text-[11px] font-bold text-ink-faint">執筆AI</p>
          <p className="mt-1 text-sm font-extrabold text-ink">grok-4.3</p>
          <p className="mt-1 text-[11px] text-ink-muted">記事を作成</p>
        </div>

        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden>
          <path
            fill="currentColor"
            d="M4 11a1 1 0 1 0 0 2h11.6l-3.3 3.3a1 1 0 1 0 1.4 1.4l5-5a1 1 0 0 0 0-1.4l-5-5a1 1 0 0 0-1.4 1.4l3.3 3.3H4Z"
          />
        </svg>

        <div className="flex-1 rounded-xl border border-accent/30 bg-accent-soft/70 px-3 py-3 text-center">
          <p className="text-[11px] font-bold text-accent">採点AI</p>
          <p className="mt-1 text-sm font-extrabold text-ink">gpt-5-mini</p>
          <p className="mt-1 text-[11px] text-ink-muted">裏どりを採点</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-4 text-xs font-semibold">
        <span className="flex items-center gap-1 text-for">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
            <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />
          </svg>
          裏どりできた記事は公開
        </span>
        <span className="flex items-center gap-1 text-against">
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
            <path d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4Z" />
          </svg>
          出来なければブロック
        </span>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        書いた本人に採点させない（自己採点の循環を避ける）ことで、根拠の甘い記事をそのまま通しません。
      </p>
    </div>
  );
}
