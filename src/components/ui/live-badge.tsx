/** パルスする 🔴 LIVE バッジ（Hot欄・タイムライン見出し用） */
export function LiveBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-extrabold tracking-wide text-hot ${className}`}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-pulse-hot rounded-full bg-hot opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-hot" />
      </span>
      🔴 LIVE
    </span>
  );
}
