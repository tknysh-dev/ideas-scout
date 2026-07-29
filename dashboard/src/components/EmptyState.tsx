export default function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-8 py-20 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      {hint ? <p className="mt-1.5 max-w-sm text-sm text-ink-dim">{hint}</p> : null}
    </div>
  );
}
