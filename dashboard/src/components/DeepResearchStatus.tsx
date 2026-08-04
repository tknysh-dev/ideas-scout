"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Pill from "@/components/Pill";
import { formatDateTime } from "@/lib/dates";

const POLL_MS = 10_000;

export interface ActiveSynthesisJob {
  status: "pending" | "running" | "failed" | "cancelled";
  created_at: string;
  run_id: string | null;
  last_error: string | null;
}

type ActivePhase = "pending" | "running";

const ACTIVE_STATUSES = new Set<ActiveSynthesisJob["status"]>(["pending", "running"]);

const PHASE: Record<ActivePhase, { title: string; body: string }> = {
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
  const isActive = ACTIVE_STATUSES.has(job.status);

  useEffect(() => {
    // Впалий чи скасований job більше не змінить стан сам — освіжати сторінку
    // раз на десять секунд тут нема чого чекати.
    if (!isActive) return;
    const tick = () => {
      if (!document.hidden) router.refresh();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [isActive, router]);

  if (isActive) {
    const phase = PHASE[job.status as ActivePhase];
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

  const failed = job.status === "failed";

  return (
    <section aria-live="polite" className="mb-8 rounded-lg border border-line bg-paper-raised p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Pill label={failed ? "Синтез не вдався" : "Синтез скасовано"} token="rejected" />
        <span className="font-mono text-[11px] text-ink-dim">
          {failed ? "востаннє спробували" : "поставлено"} {formatDateTime(job.created_at)}
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        {failed
          ? "Останній запуск синтезу на M1 завершився помилкою після всіх повторних спроб воркера, тож картку не переписано — вона лишається такою, якою була до цієї спроби."
          : "Останній запуск синтезу скасували, не діждавшись результату, тож картку не переписано — вона лишається такою, якою була до цієї спроби."}
      </p>
      {job.last_error && (
        <p className="mt-2 max-w-2xl overflow-x-auto rounded-md border border-line bg-paper p-2 font-mono text-xs text-ink-dim">
          {job.last_error}
        </p>
      )}
      <p className="mt-2 max-w-2xl text-sm text-ink-dim">
        Вставлені звіти моделей нікуди не зникли — попередня консолідація вже зберегла їх у базі,
        і невдалий синтез їх не видаляє. Ганяти дослідження в сторонніх моделях заново не треба:
        досить відкрити «Опції → Консолідувати відповіді…» і надіслати той самий текст звітів ще раз,
        щоб поставити новий синтез у чергу.
      </p>
      <p className="mt-2 text-sm text-ink-dim">
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
