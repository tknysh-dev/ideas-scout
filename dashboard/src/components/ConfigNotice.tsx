export default function ConfigNotice({
  title,
  vars,
}: {
  title: string;
  vars: string[];
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-paper-raised px-6 py-8">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="mt-1.5 text-sm text-ink-dim">
        Не заповнено env-змінн{vars.length > 1 ? "і" : "у"}:
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {vars.map((v) => (
          <li
            key={v}
            className="rounded border border-line px-2 py-1 font-mono text-xs text-ink"
          >
            {v}
          </li>
        ))}
      </ul>
    </div>
  );
}
