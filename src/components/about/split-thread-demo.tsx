/**
 * スプリットスレッド（賛成/反対/中立への画面分割）の見た目を再現したもの。
 * 実際の議論欄は src/components/issue/comment-section.tsx が担うが、ログイン状態・投票状態など
 * 依存が多いため、紹介用に静止したサンプルを別途用意する。
 */
const COLUMNS = [
  {
    id: "for",
    label: "賛成",
    shell: "border-for/30 bg-for-muted/50",
    text: "text-for",
    comment: "一次情報や複数媒体の報道が揃っている点は評価できる",
  },
  {
    id: "neutral",
    label: "中立",
    shell: "border-neutral/25 bg-neutral-muted/60",
    text: "text-neutral",
    comment: "どちらの言い分にも一理あるので、もう少し情報がほしい",
  },
  {
    id: "against",
    label: "反対",
    shell: "border-against/30 bg-against-muted/50",
    text: "text-against",
    comment: "報道と当事者の説明を踏まえると、慎重にすべきだと感じる",
  },
] as const;

export function SplitThreadDemo() {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-6 sm:px-6">
      <div className="grid gap-2.5 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col.id} className={`rounded-xl border p-3 ${col.shell}`}>
            <p className={`mb-2 text-[11px] font-extrabold tracking-wide ${col.text}`}>{col.label}</p>
            <p className="text-xs leading-relaxed text-ink-secondary">{col.comment}</p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        投票結果を賛成/反対の2択でなく3分割で見せ、自分と異なる意見が必ず画面に入る設計にしています。
      </p>
    </div>
  );
}
