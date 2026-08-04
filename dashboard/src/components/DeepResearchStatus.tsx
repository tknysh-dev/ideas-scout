"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/dates";

const POLL_MS = 10_000;

export interface ActiveSynthesisJob {
  status: "pending" | "running";
  created_at: string;
  run_id: string | null;
}

const PHASE: Record<ActiveSynthesisJob["status"], { title: string; body: string }> = {
  pending: {
    title: "Синтез у черзі",
    body:
      "Завдання прийнято, але M1 його ще не взяв — воркер виконує задачі по одній. " +
      "Якщо перед цим стоїть інше глибоке дослідження, чекати доведеться довше.",
  },
  running: {
    title: "Синтез виконується",
    body:
      "M1 зводить звіти в один вердикт: спершу сам шукає у вебі по семи додаткових блоках, " +
      "яких не було в початковому аналізі, і звіряє чужі докази, а тоді переписує текст " +
      "картки й зводить конкурентів у спільний список. Разом це до півтори години.",
  },
};

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 animate-spin text-accent" aria-hidden="true" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Сторінка рендериться на сервері, тож єдиний спосіб побачити завершення
// синтезу без ручного F5 — просити роутер перечитати її. Поки вкладка схована,
// не смикаємо: користувач усе одно нічого не бачить.
export default function DeepResearchStatus({ job }: { job: ActiveSynthesisJob }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  const phase = PHASE[job.status];

  return (
    <section aria-live="polite" className="mb-8 rounded-lg border border-line bg-paper-raised p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Spinner />
        <h2 className="text-sm font-medium text-ink">{phase.title}</h2>
        <span className="font-mono text-[11px] text-ink-dim">
          поставлено {formatDateTime(job.created_at)}
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">{phase.body}</p>
      <p className="mt-2 text-sm text-ink-dim">
        Сторінка оновлюється сама — коли синтез завершиться, тут з&apos;являться зведений
        розбір, вкладки моделей і конкуренти.{" "}
        <Link
          href={job.run_id ? "/runs?tab=history" : "/runs?tab=queue"}
          className="text-accent hover:underline"
        >
          {job.run_id ? `Лог прогону ${job.run_id}` : "Черга M1"}
        </Link>
        .
      </p>
    </section>
  );
}
