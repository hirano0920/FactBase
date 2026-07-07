interface AboutDifferentiatorCardProps {
  index: number;
  title: string;
  description: string;
}

export function AboutDifferentiatorCard({ index, title, description }: AboutDifferentiatorCardProps) {
  return (
    <div
      className="animate-fade-slide-up rounded-xl border border-border bg-surface-raised p-5"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent/8 text-xs font-bold text-accent">
        {String(index + 1).padStart(2, "0")}
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{description}</p>
    </div>
  );
}
