"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { STATUS_META, TRACK_META } from "@/lib/status";

export default function TreeFilters({ tracks }: { tracks: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const track = searchParams.get("track") ?? tracks[0] ?? "passive-income";
  const status = searchParams.get("status") ?? "";
  const sort = searchParams.get("sort") ?? "desc";

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line pb-5">
      <div className="flex rounded-md border border-line bg-paper-raised p-0.5">
        {tracks.map((t) => (
          <button
            key={t}
            onClick={() => setParam("track", t)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              track === t ? "bg-accent text-accent-ink" : "text-ink-dim hover:text-ink"
            }`}
          >
            {TRACK_META[t] ?? t}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-dim">
        Статус
        <select
          value={status}
          onChange={(e) => setParam("status", e.target.value)}
          className="rounded-md border border-line bg-paper-raised px-2 py-1.5 text-sm text-ink"
        >
          <option value="">Усі</option>
          {Object.entries(STATUS_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-ink-dim">
        Дата виявлення
        <select
          value={sort}
          onChange={(e) => setParam("sort", e.target.value)}
          className="rounded-md border border-line bg-paper-raised px-2 py-1.5 text-sm text-ink"
        >
          <option value="desc">Спочатку нові</option>
          <option value="asc">Спочатку старі</option>
        </select>
      </label>
    </div>
  );
}
