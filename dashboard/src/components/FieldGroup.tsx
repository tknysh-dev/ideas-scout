export function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-paper-raised p-5">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
        {title}
      </h2>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2.5">{children}</dl>
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-sm text-ink-dim">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </>
  );
}
