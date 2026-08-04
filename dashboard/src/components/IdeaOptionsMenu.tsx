"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import ConsolidateReportsDialog from "@/components/ConsolidateReportsDialog";
import { EASE } from "@/components/motion";
import { fetchDeepResearchPrompt } from "@/lib/actions/deep-research";

type Feedback = { tone: "ok" | "error"; text: string } | null;

const ITEMS = [
  {
    key: "prompt",
    label: "Скопіювати промпт глибокого дослідження",
    hint: "Готовий текст для вставки у вікно deep research сторонньої моделі",
  },
  {
    key: "consolidate",
    label: "Консолідувати відповіді…",
    hint: "Вставити зібрані звіти моделей і запустити зведення на M1",
  },
] as const;

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Меню замінило кнопку «Глибоке дослідження»: автоматичного конвеєра більше
// немає, тому дослідження починається з копіювання промпта, а не з постановки
// job-а (docs/plans/deep-research-handoff.md).
export default function IdeaOptionsMenu({ ideaId }: { ideaId: string }) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      close(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  function moveFocus(from: number, delta: number) {
    const next = (from + delta + ITEMS.length) % ITEMS.length;
    itemRefs.current[next]?.focus();
  }

  function copyPrompt() {
    close();
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await fetchDeepResearchPrompt(ideaId);
        if (result.error || !result.prompt) {
          setFeedback({ tone: "error", text: result.error ?? "Промпт не сформувався." });
          return;
        }
        await navigator.clipboard.writeText(result.prompt);
        setFeedback({
          tone: "ok",
          text:
            `Промпт скопійовано — ${result.prompt.length.toLocaleString("uk-UA")} символів. ` +
            "Вставляй як є: він однаковий для всіх провайдерів, а чия це відповідь — " +
            "вкажеш при консолідації.",
        });
      } catch {
        setFeedback({
          tone: "error",
          text:
            "Браузер не дав записати текст у буфер обміну. Це стається, коли сторінка відкрита " +
            "не по https або вкладка втратила фокус — клікни по сторінці й спробуй ще раз.",
        });
      }
    });
  }

  return (
    <div className="relative flex flex-col items-end gap-1.5">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="inline-flex items-center gap-2 rounded-md border border-[color:var(--research-btn-border)] bg-[color:var(--research-btn-bg)] px-3.5 py-2 text-sm font-semibold text-[color:var(--research-btn-fg)] shadow-[0_1px_2px_rgba(20,60,100,0.2)] transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-[color:var(--research-btn-hover)] hover:shadow-[0_3px_8px_rgba(20,60,100,0.24)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--research-btn-border)] disabled:translate-y-0 disabled:cursor-default disabled:opacity-55 disabled:shadow-none"
      >
        {pending ? "Готуємо промпт…" : "Опції"}
        <ChevronIcon />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label="Опції глибокого дослідження"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: EASE }}
            className="absolute right-0 top-full z-30 mt-1.5 w-[min(20rem,80vw)] overflow-hidden rounded-lg border border-line bg-paper-raised py-1 shadow-xl"
          >
            {ITEMS.map((item, index) => (
              <button
                key={item.key}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => (item.key === "prompt" ? copyPrompt() : (close(false), setDialog(true)))}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveFocus(index, 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveFocus(index, -1);
                  } else if (event.key === "Tab") {
                    close(false);
                  }
                }}
                className="block w-full px-3.5 py-2.5 text-left transition-colors hover:bg-paper focus:bg-paper focus:outline-none"
              >
                <span className="block text-sm text-ink">{item.label}</span>
                <span className="mt-0.5 block text-xs text-ink-dim">{item.hint}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {feedback && (
        <p
          aria-live="polite"
          className={`max-w-md text-right text-xs ${
            feedback.tone === "error" ? "text-[color:var(--status-rejected-fg)]" : "text-ink-dim"
          }`}
        >
          {feedback.text}
        </p>
      )}

      <AnimatePresence>
        {dialog && (
          <ConsolidateReportsDialog
            ideaId={ideaId}
            onClose={() => {
              setDialog(false);
              trigger.current?.focus();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
