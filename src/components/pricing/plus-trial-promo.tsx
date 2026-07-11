import Link from "next/link";
import { SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface PlusTrialPromoProps {
  className?: string;
  /** sidebar 用のコンパクト表示 */
  compact?: boolean;
}

/** Plus/Pro の 3日間無料体験を目立たせるプロモ */
export function PlusTrialPromo({ className, compact = false }: PlusTrialPromoProps) {
  if (compact) {
    return (
      <div
        className={cn(
          "rounded-xl border-2 border-warm/40 bg-gradient-to-br from-warm-muted to-surface-raised p-4",
          className,
        )}
      >
        <p className="mb-1 inline-flex rounded-full bg-warm px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white">
          3日間無料
        </p>
        <p className="mt-2 text-sm font-bold text-ink">{SITE.name} Plus を試す</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
          層の動き・両陣営マップが見られる。今すぐ3日間、料金はかかりません。
        </p>
        <Link
          href="/pricing"
          className="mt-3 block rounded-full bg-ink px-3 py-2.5 text-center text-xs font-bold text-surface no-underline transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          無料体験をはじめる
        </Link>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border-2 border-warm/35 bg-gradient-to-r from-warm-muted via-surface-raised to-accent/5 px-5 py-4 text-center sm:px-8",
        className,
      )}
    >
      <p className="inline-flex rounded-full bg-warm px-3 py-1 text-xs font-extrabold tracking-wide text-white">
        3日間無料体験
      </p>
      <p className="mt-3 text-base font-bold text-ink sm:text-lg">
        Plus / Pro は<strong className="text-warm-hover"> 最初の3日間は無料</strong>。いつでも解約できます。
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        投票・議論は無料。層の動き・両陣営分析・レスバ支援 AI を試すときだけ課金が始まります。
      </p>
    </div>
  );
}
