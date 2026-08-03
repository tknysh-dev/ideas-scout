import Card from "@/components/Card";

export function FieldGroup({
  title,
  index = 0,
  exclude,
  children,
}: {
  title: string;
  index?: number;
  exclude?: string;
  children: React.ReactNode;
}) {
  return (
    <Card as="section" index={index} exclude={exclude}>
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
        {title}
      </h2>
      <dl className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-x-4 sm:gap-y-2.5">
        {children}
      </dl>
    </Card>
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
    <div className="flex flex-col gap-0.5 sm:contents">
      <dt className="text-sm text-ink-dim">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}
