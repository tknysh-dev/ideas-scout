"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import Pill from "@/components/Pill";
import { EASE } from "@/components/motion";
import {
  commitDeepResearchReports,
  previewDeepResearchReports,
  type ReportSummary,
} from "@/lib/actions/deep-research";
import type { ReportStatus } from "@/lib/deep-research-reports";

const STATUS_META: Record<ReportStatus, { label: string; token: string; note: string }> = {
  ok: { label: "Готово", token: "accepted", note: "піде в синтез" },
  refused: {
    label: "Без пошуку",
    token: "approved_pending",
    note: "збережеться як слід відмови, у синтез не піде",
  },
  invalid: {
    label: "Не розібрано",
    token: "rejected",
    note: "збережеться як є, але вердиктів із нього не буде",
  },
  foreign: { label: "Інша ідея", token: "rejected", note: "не буде записано" },
};

function countLabel(count: number, forms: [string, string, string]) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${forms[0]}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${forms[1]}`;
  return `${count} ${forms[2]}`;
}

function ReportRow({ report }: { report: ReportSummary }) {
  const meta = STATUS_META[report.status];
  return (
    <li className="rounded-md border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">{report.label}</span>
        <Pill label={meta.label} token={meta.token} title={meta.note} />
        {report.model && <span className="font-mono text-[11px] text-ink-dim">{report.model}</span>}
      </div>
      {report.status === "ok" && (
        <p className="mt-1 text-xs text-ink-dim">
          {countLabel(report.criteriaCount, ["критерій", "критерії", "критеріїв"])},{" "}
          {countLabel(report.competitorsCount, ["конкурент", "конкуренти", "конкурентів"])}
        </p>
      )}
      {report.problem && <p className="mt-1 text-xs text-ink-dim">{report.problem}</p>}
      {report.notes.map((note, index) => (
        <p key={index} className="mt-1 text-xs text-ink-dim">
          {note}
        </p>
      ))}
    </li>
  );
}

// Два кроки навмисно: розбір нічого не пише в базу, тому власник бачить, що
// саме портал зрозумів у вставленому тексті, ще до того, як цим перезапишуться
// вкладки моделей і запуститься півторагодинний синтез на M1.
export default function ConsolidateReportsDialog({
  ideaId,
  onClose,
}: {
  ideaId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [blob, setBlob] = useState("");
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [validCount, setValidCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    field.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function preview() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await previewDeepResearchReports(ideaId, blob);
        if (result.error) {
          setReports(null);
          setError(result.error);
          return;
        }
        setReports(result.reports ?? []);
        setValidCount(result.validCount ?? 0);
      } catch {
        setError("Не вдалося зв'язатися з сервером. Онови сторінку і спробуй ще раз.");
      }
    });
  }

  function commit() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await commitDeepResearchReports(ideaId, blob);
        if (result.error) {
          setError(result.error);
          return;
        }
        setDone(
          `Збережено ${countLabel(result.savedCount ?? 0, ["звіт", "звіти", "звітів"])} ` +
            `і ${countLabel(result.verdictCount ?? 0, ["вердикт", "вердикти", "вердиктів"])}. ` +
            (result.alreadyQueued
              ? "Синтез уже стояв у черзі — другий раз не додаємо."
              : "Синтез поставлено в чергу M1."),
        );
        router.refresh();
      } catch {
        setError("Не вдалося зв'язатися з сервером. Онови сторінку і спробуй ще раз.");
      }
    });
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Консолідація відповідей моделей"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: EASE }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.2, ease: EASE }}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-lg border border-line bg-paper-raised p-5 text-left shadow-xl"
      >
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
          Консолідувати відповіді моделей
        </h3>

        {done ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">{done}</p>
            <p className="text-sm text-ink-dim">
              Далі M1 зводить звіти в один вердикт — це займає до півтори години. Хід роботи
              видно блоком стану на цій сторінці і в журналі прогонів.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-line px-3 py-2 text-sm text-ink-dim hover:border-line-strong hover:text-ink"
              >
                Закрити
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label htmlFor={fieldId} className="flex flex-col gap-1 text-sm text-ink-dim">
              Відповіді моделей одним текстом
              <span className="text-xs">
                Вставляй усі звіти підряд, порядок неважливий. Кожен має починатися рядком
                <span className="mx-1 font-mono">===== DEEP RESEARCH REPORT START | …</span>
                і закінчуватися відповідним рядком END — саме за ними портал розрізняє, де чий
                звіт.
              </span>
            </label>
            <textarea
              id={fieldId}
              ref={field}
              value={blob}
              onChange={(event) => {
                setBlob(event.target.value);
                // Розбір стосується попереднього тексту — показувати його далі
                // означало б запустити консолідацію не того, що на екрані.
                setReports(null);
                setError(null);
              }}
              rows={12}
              spellCheck={false}
              placeholder={"===== DEEP RESEARCH REPORT START | ChatGPT | " + ideaId + " ====="}
              className="rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent"
            />

            {reports && (
              <div>
                <p className="mb-2 text-sm text-ink">
                  Розпізнано {countLabel(reports.length, ["звіт", "звіти", "звітів"])}, придатних
                  до консолідації — {validCount}.
                </p>
                <ul className="space-y-2">
                  {reports.map((report) => (
                    <ReportRow key={report.label} report={report} />
                  ))}
                </ul>
                {validCount === 0 && (
                  <p className="mt-2 text-xs text-ink-dim">
                    Поки жоден звіт не годиться для зведення. Виправ те, що описано вище, і
                    розбери текст ще раз — у базу досі нічого не записано.
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-xs text-[color:var(--status-rejected-fg)]">{error}</p>}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="rounded-md border border-line px-3 py-2 text-sm text-ink-dim hover:border-line-strong hover:text-ink disabled:opacity-40"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={preview}
                disabled={pending || blob.trim().length === 0}
                className="rounded-md border border-line px-3 py-2 text-sm text-ink hover:border-line-strong disabled:opacity-40"
              >
                {pending && !reports ? "Розбираємо…" : "Розібрати текст"}
              </button>
              <button
                type="button"
                onClick={commit}
                disabled={pending || !reports || validCount === 0}
                className="rounded-md px-3 py-2 text-sm font-medium transition-opacity hover:opacity-85 disabled:opacity-40"
                style={{
                  backgroundColor: "var(--accept-btn-bg)",
                  color: "var(--accept-btn-fg)",
                  border: "1px solid var(--accept-btn-bg)",
                }}
              >
                {pending && reports ? "Записуємо…" : "Запустити консолідацію"}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
