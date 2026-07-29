import { STATUS_META } from "@/lib/status";
import type { IdeaStatus } from "@/lib/types";

export default function StatusBadge({ status }: { status: IdeaStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      title={meta.hint}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide"
      style={{
        color: `var(--status-${meta.tone}-fg)`,
        backgroundColor: `var(--status-${meta.tone}-bg)`,
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `var(--status-${meta.tone}-fg)` }}
      />
      {meta.label}
    </span>
  );
}
