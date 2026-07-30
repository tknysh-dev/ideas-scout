"use client";

import { Fragment, useState } from "react";
import type { RunRow } from "@/lib/types";
import { formatDateTime } from "@/lib/dates";


const STATUS_TONE: Record<string, string> = {
  ok: "text-[color:var(--status-accepted-fg)]",
  error: "text-[color:var(--status-rejected-fg)]",
  dry_run: "text-[color:var(--status-analyzing-fg)]",
  skipped_work_hours: "text-ink-dim",
};

function RunErrors({ errors }: { errors: unknown }) {
  const list = Array.isArray(errors) ? errors : [];
  if (list.length === 0) return <span className="text-ink-dim">—</span>;
  return <span className="text-[color:var(--status-rejected-fg)]">{list.length}</span>;
}

function TokenUsage({ usage }: { usage: unknown }) {
  if (!usage || typeof usage !== "object") return <span className="text-ink-dim">—</span>;
  const entries = Object.entries(usage as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-ink-dim">—</span>;
  return (
    <span className="font-mono text-xs">
      {entries.map(([key, value]) => `${key}: ${value}`).join(", ")}
    </span>
  );
}

export default function RunsTable({ runs }: { runs: RunRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-paper-raised">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[11px] uppercase tracking-wide text-ink-dim">
            <th className="px-4 py-3 font-medium">Run ID</th>
            <th className="px-4 py-3 font-medium">Джоб</th>
            <th className="px-4 py-3 font-medium">Провайдер</th>
            <th className="px-4 py-3 font-medium">Початок</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Токени</th>
            <th className="px-4 py-3 font-medium">Помилки</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const isOpen = expanded === run.run_id;
            return (
              <Fragment key={run.run_id}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : run.run_id)}
                  className="cursor-pointer border-b border-line/60 transition-colors hover:bg-paper"
                >
                  <td className="px-4 py-3 font-mono text-xs text-ink">{run.run_id}</td>
                  <td className="px-4 py-3 text-ink">{run.job}</td>
                  <td className="px-4 py-3 text-ink-dim">{run.provider ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-dim">
                    {formatDateTime(run.started_at)}
                  </td>
                  <td className={`px-4 py-3 ${STATUS_TONE[run.status ?? ""] ?? "text-ink"}`}>
                    {run.status ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <TokenUsage usage={run.token_usage} />
                  </td>
                  <td className="px-4 py-3">
                    <RunErrors errors={run.errors} />
                  </td>
                </tr>
                {isOpen && (
                  <tr key={`${run.run_id}-details`} className="border-b border-line/60 bg-paper">
                    <td colSpan={7} className="px-4 py-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="mb-1 font-mono text-[11px] uppercase text-ink-dim">
                            Оброблені URL ({run.processed_urls?.length ?? 0})
                          </p>
                          {run.processed_urls && run.processed_urls.length > 0 ? (
                            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                              {run.processed_urls.map((url) => (
                                <li key={url} className="truncate text-ink-dim">
                                  {url}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-ink-dim">Немає</p>
                          )}
                        </div>
                        <div>
                          <p className="mb-1 font-mono text-[11px] uppercase text-ink-dim">
                            Метадані
                          </p>
                          <pre className="max-h-48 overflow-auto rounded bg-paper-raised p-2 text-xs text-ink-dim">
                            {JSON.stringify(run.meta ?? {}, null, 2)}
                          </pre>
                        </div>
                        {run.notes && (
                          <div className="md:col-span-2">
                            <p className="mb-1 font-mono text-[11px] uppercase text-ink-dim">
                              Нотатки
                            </p>
                            <p className="text-sm text-ink">{run.notes}</p>
                          </div>
                        )}
                        {Array.isArray(run.errors) && run.errors.length > 0 && (
                          <div className="md:col-span-2">
                            <p className="mb-1 font-mono text-[11px] uppercase text-[color:var(--status-rejected-fg)]">
                              Помилки
                            </p>
                            <pre className="max-h-48 overflow-auto rounded bg-paper-raised p-2 text-xs text-[color:var(--status-rejected-fg)]">
                              {JSON.stringify(run.errors, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
