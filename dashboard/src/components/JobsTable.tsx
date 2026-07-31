import { formatDateTime } from "@/lib/dates";
import type { JobRow } from "@/lib/types";

const STATUS_META: Record<JobRow["status"], { label: string; tone: string }> = {
  pending: { label: "У черзі", tone: "text-ink-dim" },
  running: { label: "Виконується", tone: "text-[color:var(--status-analyzing-fg)]" },
  succeeded: { label: "Успішно", tone: "text-[color:var(--status-accepted-fg)]" },
  failed: { label: "Помилка", tone: "text-[color:var(--status-rejected-fg)]" },
  cancelled: { label: "Скасовано", tone: "text-ink-dim" },
};

export default function JobsTable({ jobs }: { jobs: JobRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-paper-raised">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-wide text-ink-dim">
            <th className="px-4 py-3 font-medium">Створено</th>
            <th className="px-4 py-3 font-medium">Тип</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Спроба</th>
            <th className="px-4 py-3 font-medium">Worker</th>
            <th className="px-4 py-3 font-medium">Run ID</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const status = STATUS_META[job.status];
            return (
              <tr key={job.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-ink-dim">
                  {formatDateTime(job.created_at)}
                </td>
                <td className="px-4 py-3 text-ink">{job.type}</td>
                <td className={`px-4 py-3 ${status.tone}`} title={job.last_error ?? undefined}>
                  {status.label}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-dim">
                  {job.attempt_count}/{job.max_attempts}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-dim">
                  {job.worker_id ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-dim">
                  {job.run_id ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
