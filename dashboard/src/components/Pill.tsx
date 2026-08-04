// Плашка статусу — спільна для серверних розділів картки ідеї і для клієнтських
// діалогів. Живе окремим файлом саме тому: у VerdictDetails вона тягла б за
// собою react-markdown у клієнтський бандл.
export default function Pill({
  label,
  token,
  title,
}: {
  label: string;
  token: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide"
      style={{
        color: `var(--status-${token}-fg)`,
        backgroundColor: `var(--status-${token}-bg)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `var(--status-${token}-fg)` }} />
      {label}
    </span>
  );
}
