/**
 * HERO背景用の「実画面モック」。実際の争点ページ（src/app/issues/[slug]/article/page.tsx の
 * VerificationBar等）と同じ見出し・要約・検証バッジの構成を、斜め視点＋フェードで背景に敷く。
 * スクリーンショットではなく実コンポーネントと同じ文言・トークンで組むことで、
 * 実際のUIそのものだと伝わるようにする（かつテーマ変更にも自動追従する）。
 */
export function HeroMockupBackdrop() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        maskImage:
          "radial-gradient(ellipse 65% 60% at 62% 38%, black 0%, transparent 72%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 65% 60% at 62% 38%, black 0%, transparent 72%)",
      }}
    >
      <div
        className="absolute left-[58%] top-[42%] w-[36rem] max-w-none -translate-x-1/2 -translate-y-1/2"
        style={{
          transform: "perspective(1400px) rotateX(10deg) rotateY(-16deg) rotateZ(2deg)",
        }}
      >
        <div className="rounded-2xl border border-border bg-surface-raised p-6 opacity-60 shadow-2xl">
          <h3 className="text-xl font-extrabold leading-snug text-ink text-balance">
            国旗損壊罪法案は表現の自由にどう影響すると思いますか？
          </h3>

          <div className="mt-4 rounded-xl bg-surface-muted p-4">
            <p className="mb-1.5 text-xs font-bold text-accent">要約</p>
            <p className="text-sm leading-relaxed text-ink-secondary">
              沖縄タイムスは沖縄弁護士会が衆院通過した日本国旗損壊罪法案に反対し表現の自由侵害として
              国会に廃案を求める声明を発表したと報じています。時事ドットコムは憲法学者の百地章氏が
              国家の象徴として必要な法律と評価したと伝えています。
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
              主張の裏取り済み
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
              5件のソースを横断比較
            </span>
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
              報道ベース・真偽は未確認
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
