"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { STATUS_META, TRACK_META } from "@/lib/status";
import type { IdeaStatus } from "@/lib/types";

const STATUS_ENTRIES = Object.entries(STATUS_META) as [IdeaStatus, { label: string }][];
const ALL_STATUSES = STATUS_ENTRIES.map(([value]) => value);

// Вибір статусів запам'ятовується окремо на кожен трек: у «пасивному доході» й
// «застосунках» різні реєстри й різна стадія, тому й дивляться на них по-різному.
const storageKey = (track: string) => `ideas-scout:status-filter:${track}`;

export default function TreeFilters({
  tracks,
  counts,
}: {
  tracks: string[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const track = searchParams.get("track") ?? tracks[0] ?? "passive-income";
  // Три різні стани: параметра немає — фільтр не задавали (видно все); порожній
  // рядок — знято всі галочки (не видно нічого); список — підмножина.
  const raw = searchParams.get("status");
  const selected = raw === null ? ALL_STATUSES : (raw.split(",").filter(Boolean) as IdeaStatus[]);

  const navigate = useCallback(
    (changes: Record<string, string | null>, replace = false) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) params.delete(key);
        else params.set(key, value);
      }
      const url = `/?${params.toString()}`;
      if (replace) router.replace(url);
      else router.push(url);
    },
    [router, searchParams],
  );

  // Збережений вибір підставляється лише коли URL мовчить — так посилання з
  // явним ?status= (наприклад, збережене в закладках) не перебивається сховищем.
  useEffect(() => {
    if (raw !== null) return;
    const stored = window.localStorage.getItem(storageKey(track));
    if (stored === null) return;
    navigate({ status: stored }, true);
  }, [raw, track, navigate]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function setStatuses(next: IdeaStatus[]) {
    const value = next.join(",");
    window.localStorage.setItem(storageKey(track), value);
    navigate({ status: value });
  }

  function switchTrack(next: string) {
    const stored = window.localStorage.getItem(storageKey(next));
    navigate({ track: next, status: stored });
  }

  const allSelected = selected.length === ALL_STATUSES.length;
  const summary = allSelected
    ? "Усі"
    : selected.length === 0
      ? "Нічого не вибрано"
      : selected.length <= 2
        ? selected.map((s) => STATUS_META[s]?.label ?? s).join(", ")
        : `Вибрано ${selected.length}`;

  return (
    <div>
      <div className="flex gap-1 border-b border-line">
        {tracks.map((t) => {
          const isActive = track === t;
          return (
            <button
              key={t}
              onClick={() => switchTrack(t)}
              // -mb-px: нижня межа активного табу лягає рівно на межу контейнера,
              // інакше таб «стрибає» на піксель відносно неактивних.
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "border-accent text-ink"
                  : "border-transparent text-ink-dim hover:text-ink"
              }`}
            >
              {TRACK_META[t] ?? t}
              <span className="ml-2 font-mono text-xs text-ink-dim">{counts[t] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 py-4">
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 rounded-md border border-line bg-paper-raised px-3 py-1.5 text-sm text-ink"
          >
            <span className="text-ink-dim">Статус:</span>
            {summary}
            <span className="text-xs text-ink-dim">▾</span>
          </button>

          {open && (
            <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-line bg-paper-raised p-1 shadow-lg">
              {STATUS_ENTRIES.map(([value, meta]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-paper"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(value)}
                    onChange={() =>
                      setStatuses(
                        selected.includes(value)
                          ? selected.filter((s) => s !== value)
                          : ALL_STATUSES.filter((s) => s === value || selected.includes(s)),
                      )
                    }
                    className="accent-[color:var(--accent)]"
                  />
                  {meta.label}
                </label>
              ))}
              <button
                onClick={() => setStatuses(allSelected ? [] : ALL_STATUSES)}
                className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-ink-dim hover:bg-paper hover:text-ink"
              >
                {allSelected ? "Зняти всі" : "Вибрати всі"}
              </button>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-dim">
          Дата виявлення
          <select
            value={searchParams.get("sort") ?? "desc"}
            onChange={(e) => navigate({ sort: e.target.value })}
            className="rounded-md border border-line bg-paper-raised px-2 py-1.5 text-sm text-ink"
          >
            <option value="desc">Спочатку нові</option>
            <option value="asc">Спочатку старі</option>
          </select>
        </label>
      </div>
    </div>
  );
}
