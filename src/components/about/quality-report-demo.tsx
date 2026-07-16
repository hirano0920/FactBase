/**
 * 読者からの品質報告（IssueQualityReport）が閾値に達した際に出る人間確認中バナーの見た目を
 * 紹介用に再現したもの。実バナーは src/app/issues/[slug]/page.tsx（issue.underReview）。
 */
export function QualityReportDemo() {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-6 sm:px-6">
      <div className="rounded-md border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        複数の利用者からこの争点の内容について報告があり、現在人間のスタッフが内容を確認しています。
        投票・議論は引き続き可能です。
      </div>

      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="text-ink-faint">読者からの品質報告</span>
        <span className="rounded-full border border-border bg-surface-muted px-2.5 py-1 font-semibold text-ink-muted">
          🚩 誤った要約・的外れなスレ立てを報告
        </span>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        報告が閾値に達すると自動的に人間確認待ちを明示します。記事を消して無かったことにはせず、
        透明性ログとして残します。
      </p>
    </div>
  );
}
