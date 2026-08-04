"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { EASE } from "@/components/motion";

// Мітки колись правились руками просто в тексті промпта, і модель, побачивши
// незаповнений плейсхолдер, підставляла першу назву, яка траплялась поруч, —
// звіт тихо лягав під чужим іменем. Тепер сервіс і модель питаємо тут і
// вклеюємо в промпт готовими: людині лишається вибір, а не редагування.
export default function ResearcherLabelDialog({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void;
  onSubmit: (researcher: string, model: string) => void;
  pending: boolean;
}) {
  const baseId = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const [researcher, setResearcher] = useState("");
  const [model, setModel] = useState("");

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const ready = researcher.trim().length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: EASE }}
      className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-line bg-paper-raised p-4 shadow-lg"
      role="dialog"
      aria-labelledby={`${baseId}-title`}
    >
      <h3 id={`${baseId}-title`} className="text-sm font-medium text-ink">
        Куди вставлятимеш промпт?
      </h3>
      <p className="mt-1 text-xs text-ink-dim">
        Ці підписи поїдуть у звіт разом із відповіддю. За сервісом розкладаються вкладки,
        за моделлю потім видно, чим саме зроблено старіші дослідження.
      </p>

      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !pending) onSubmit(researcher, model);
        }}
      >
        <div>
          <label htmlFor={`${baseId}-service`} className="block text-xs text-ink-dim">
            Сервіс
          </label>
          <input
            ref={firstField}
            id={`${baseId}-service`}
            value={researcher}
            onChange={(event) => setResearcher(event.target.value)}
            placeholder="наприклад DeepSeek"
            className="mt-1 w-full rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor={`${baseId}-model`} className="block text-xs text-ink-dim">
            Модель <span className="text-ink-dim">(якщо знаєш)</span>
          </label>
          <input
            id={`${baseId}-model`}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="наприклад DeepSeek-V3"
            className="mt-1 w-full rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-ink-dim hover:text-ink"
          >
            Скасувати
          </button>
          <button
            type="submit"
            disabled={!ready || pending}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50"
          >
            {pending ? "Готую…" : "Скопіювати промпт"}
          </button>
        </div>
      </form>
    </motion.div>
  );
}
