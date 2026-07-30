import { ideaTypeMeta } from "@/lib/status";

// Механіка — контейнер («стос» ніш), ніша — гілка від нього: форма іконки має
// читатись без тексту, бо ці два типи в переліках стоять поруч.
function TypeIcon({ type }: { type: string }) {
  if (type === "mechanic") {
    return (
      <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
        <rect x="1.5" y="1.5" width="9" height="3" rx="0.8" />
        <path d="M2.5 6.5h7M3.5 9.5h5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M3 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5H8" strokeLinecap="round" />
      <circle cx="9.5" cy="8.5" r="1.6" />
    </svg>
  );
}

export default function TypeBadge({ type }: { type: string }) {
  const meta = ideaTypeMeta(type);
  const token = type === "mechanic" ? "mechanic" : "niche";
  return (
    <span
      title={meta.hint}
      className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide"
      style={{
        color: `var(--type-${token}-fg)`,
        backgroundColor: `var(--type-${token}-bg)`,
      }}
    >
      <TypeIcon type={type} />
      {meta.label}
    </span>
  );
}
