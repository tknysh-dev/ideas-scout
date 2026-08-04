"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import Pill from "@/components/Pill";
import { EASE } from "@/components/motion";
import {
  commitDeepResearchReports,
  fetchKnownResearcherModels,
  previewDeepResearchReports,
  type KnownModels,
  type ReportSummary,
} from "@/lib/actions/deep-research";
import type { ReportStatus } from "@/lib/deep-research-reports";

// Найпопулярніші сервіси з режимом глибокого дослідження. Список навмисно
// статичний: він міняється рідше, ніж моделі всередині сервісів, а «інший»
// не дає йому стати вузьким місцем, поки список не оновили.
export const PROVIDERS = [
  "ChatGPT",
  "Claude",
  "Gemini",
  "Perplexity",
  "Grok",
  "DeepSeek",
  "Copilot",
  "Le Chat",
  "Qwen",
  "Kimi",
] as const;

const OTHER = "Інший…";

const STATUS_META: Record<ReportStatus, { label: string; token: string; note: string }> = {
  ok: { label: "Готово", token: "accepted", note: "вердикти й конкуренти розібрані" },
  prose: {
    label: "Тільки текст",
    token: "analyzing",
    note: "піде в синтез прозою, окремої вкладки з вердиктами не буде",
  },
  refused: {
    label: "Без пошуку",
    token: "approved_pending",
    note: "збережеться як слід відмови, у синтез не піде",
  },
  empty: { label: "Порожньо", token: "rejected", note: "нічого не вставлено" },
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
        <span className="text-sm font-medium text-ink">{report.provider}</span>
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

interface Entry {
  provider: string;
  /** Назва сервісу, коли його ще немає в списку. */
  custom: string;
  model: string;
  text: string;
}

function providerOf(entry: Entry) {
  return entry.provider === OTHER ? entry.custom.trim() : entry.provider;
}

function payload(entries: Entry[]) {
  return entries.map((entry) => ({
    provider: providerOf(entry),
    model: entry.model,
    text: entry.text,
  }));
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
  const [entries, setEntries] = useState<Entry[]>([{ provider: PROVIDERS[0], custom: "", model: "", text: "" }]);
  const [activeTab, setActiveTab] = useState(0);
  const [knownModels, setKnownModels] = useState<KnownModels>({});
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [validCount, setValidCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    fetchKnownResearcherModels().then(setKnownModels).catch(() => {});
  }, []);

  useEffect(() => {
    field.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Розбір стосується попереднього вмісту — лишати його на екрані означало б
  // запустити консолідацію не того, що зараз у полях.
  function update(index: number, patch: Partial<Entry>) {
    setEntries(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
    setReports(null);
    setError(null);
  }

  function preview() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await previewDeepResearchReports(ideaId, payload(entries));
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
        const result = await commitDeepResearchReports(ideaId, payload(entries));
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
            <div className="flex flex-wrap items-center gap-1 border-b border-line">
              {entries.map((entry, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setActiveTab(index)}
                  className={`relative px-3 py-2 text-sm ${
                    index === activeTab ? "text-ink" : "text-ink-dim hover:text-ink"
                  }`}
                >
                  {entry.provider === OTHER ? "Інший" : entry.provider}
                  {index === activeTab && (
                    <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />
                  )}
                </button>
              ))}
              {entries.length < PROVIDERS.length && (
                <button
                  type="button"
                  title="Додати відповідь ще одного провайдера"
                  onClick={() => {
                    const used = new Set(entries.map((entry) => entry.provider));
                    const free = PROVIDERS.find((name) => !used.has(name)) ?? OTHER;
                    setEntries([...entries, { provider: free, custom: "", model: "", text: "" }]);
                    setActiveTab(entries.length);
                    setReports(null);
                  }}
                  className="px-3 py-2 text-sm text-ink-dim hover:text-accent"
                >
                  + ще одна
                </button>
              )}
            </div>

            {entries.map((entry, index) => (
              <div key={index} hidden={index !== activeTab} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-xs text-ink-dim">
                    Провайдер
                    <select
                      value={entry.provider}
                      onChange={(event) => {
                        update(index, { provider: event.target.value });
                      }}
                      className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                    >
                      {PROVIDERS.map((name) => (
                        <option
                          key={name}
                          value={name}
                          disabled={name !== entry.provider && entries.some((e) => e.provider === name)}
                        >
                          {name}
                        </option>
                      ))}
                      <option value={OTHER}>{OTHER}</option>
                    </select>
                  </label>

                  {entry.provider === OTHER && (
                    <label className="flex flex-col gap-1 text-xs text-ink-dim">
                      Назва сервісу
                      <input
                        value={entry.custom}
                        onChange={(event) => update(index, { custom: event.target.value })}
                        placeholder="як він зветься"
                        className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                      />
                    </label>
                  )}

                  <label className="flex flex-col gap-1 text-xs text-ink-dim">
                    Модель <span className="text-ink-dim">(необовʼязково)</span>
                    <input
                      list={`${fieldId}-models-${index}`}
                      value={entry.model}
                      onChange={(event) => update(index, { model: event.target.value })}
                      placeholder="вписується один раз"
                      className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                    />
                    <datalist id={`${fieldId}-models-${index}`}>
                      {(knownModels[providerOf(entry)] ?? []).map((name: string) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </label>

                  {entries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setEntries(entries.filter((_, i) => i !== index));
                        setActiveTab(Math.max(0, index - 1));
                        setReports(null);
                      }}
                      className="px-2 py-1.5 text-xs text-ink-dim hover:text-[color:var(--status-rejected-fg)]"
                    >
                      прибрати
                    </button>
                  )}
                </div>

                <label htmlFor={`${fieldId}-${index}`} className="flex flex-col gap-1 text-sm text-ink-dim">
                  Відповідь моделі
                  <span className="text-xs">
                    Скопіюй її вікно цілком — розбирати текст на частини не треба.
                  </span>
                </label>
                <textarea
                  id={`${fieldId}-${index}`}
                  ref={index === 0 ? field : undefined}
                  value={entry.text}
                  onChange={(event) => update(index, { text: event.target.value })}
                  rows={10}
                  spellCheck={false}
                  className="rounded-md border border-line bg-paper px-3 py-2 font-mono text-xs text-ink outline-none focus:border-accent"
                />
              </div>
            ))}

            {reports && (
              <div>
                <p className="mb-2 text-sm text-ink">
                  Розпізнано {countLabel(reports.length, ["звіт", "звіти", "звітів"])}, придатних
                  до консолідації — {validCount}.
                </p>
                <ul className="space-y-2">
                  {reports.map((report) => (
                    <ReportRow key={report.provider} report={report} />
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
                disabled={pending || entries.every((entry) => entry.text.trim().length === 0)}
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
