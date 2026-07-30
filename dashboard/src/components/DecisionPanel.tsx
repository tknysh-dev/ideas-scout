"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideIdea, type DecisionAction } from "@/lib/actions/decisions";
import { REJECTION_META, statusMeta } from "@/lib/status";
import type { IdeaStatus, RejectionCode } from "@/lib/types";

const REJECTION_CODES = Object.keys(REJECTION_META) as RejectionCode[];

const ACTION_META: Record<DecisionAction, { label: string; hint: string }> = {
  accepted: {
    label: "Прийняти",
    hint: "Ідея годна — збирач шукатиме схожі механіки. Це оцінка, не запуск у роботу",
  },
  rejected: { label: "Відхилити", hint: "Потрібні код відмови й причина" },
};

// Обидві кнопки з рамкою: без неї заливна «Прийняти» була б на 2px нижча за
// контурну «Відхилити» і читалась як менша.
const BUTTON_STYLE: Record<DecisionAction, React.CSSProperties> = {
  accepted: {
    backgroundColor: "var(--accept-btn-bg)",
    color: "var(--accept-btn-fg)",
    border: "1px solid var(--accept-btn-bg)",
  },
  rejected: {
    border: "1px solid var(--status-rejected-fg)",
    color: "var(--status-rejected-fg)",
  },
};

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M2.5 6.3 4.8 8.6 9.5 3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function DecisionPanel({
  ideaId,
  currentStatus,
  compact = false,
  // Кнопки в шапці картки ідеї — без власної рамки й заголовка, вирівняні
  // праворуч під описом.
  bare = false,
  onDecided,
}: {
  ideaId: string;
  currentStatus: IdeaStatus;
  compact?: boolean;
  bare?: boolean;
  onDecided?: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [rejectionCode, setRejectionCode] = useState<RejectionCode | "">("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DecisionAction | null>(null);
  const [dialog, setDialog] = useState<DecisionAction | null>(null);

  // Рішення вже ухвалене — панель тепер переглядає його, а не виносить уперше.
  const isRevision = currentStatus !== "approved_pending";

  function submit(action: DecisionAction, text: string, code: RejectionCode | undefined) {
    startTransition(async () => {
      const result = await decideIdea({ ideaId, action, reason: text, rejectionCode: code });
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(action);
      setReason("");
      setRejectionCode("");
      setDialog(null);
      onDecided?.();
      router.refresh();
    });
  }

  function start(action: DecisionAction) {
    setError(null);
    setDone(null);
    // Деталі питаємо лише там, де без них рішення не читається: відмова
    // (код + причина) і перегляд уже ухваленого рішення (причина).
    if (action === "rejected" || isRevision) {
      setDialog(action);
      return;
    }
    submit(action, "", undefined);
  }

  function confirmDialog() {
    if (!dialog) return;
    const text = reason.trim();
    if (dialog === "rejected" && (!text || !rejectionCode)) {
      setError("Для відхилення обов'язково вкажи причину і код відмови.");
      return;
    }
    if (isRevision && !text) {
      setError("Зміна вже ухваленого рішення вимагає причини.");
      return;
    }
    setError(null);
    submit(dialog, text, dialog === "rejected" ? (rejectionCode as RejectionCode) : undefined);
  }

  const closeDialog = useCallback(() => {
    setDialog(null);
    setError(null);
  }, []);

  return (
    <div
      className={
        bare
          ? "flex flex-col items-end gap-2"
          : `rounded-lg border border-line bg-paper-raised ${compact ? "p-4" : "p-5"}`
      }
    >
      {!compact && !bare && (
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
          {isRevision ? "Змінити рішення" : "Твоє рішення"}
        </h2>
      )}

      {done && (
        <p className={`text-sm text-ink-dim ${bare ? "" : "mb-3"}`}>
          Рішення записано: {ACTION_META[done].label.toLowerCase()}.
        </p>
      )}

      <div className={`flex flex-wrap items-center gap-2 ${bare ? "justify-end" : ""}`}>
        {(Object.keys(ACTION_META) as DecisionAction[]).map((action) => {
          const isCurrent = action === currentStatus;
          // «Відхилити» лишається активним і на відхиленій ідеї — так міняють
          // код відмови, не проводячи запис через проміжний статус.
          const locked = isCurrent && action !== "rejected";
          return (
            <button
              key={action}
              type="button"
              disabled={pending || locked}
              onClick={() => start(action)}
              title={
                isCurrent
                  ? `Поточний статус: ${statusMeta(currentStatus).label.toLowerCase()}`
                  : ACTION_META[action].hint
              }
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-opacity hover:opacity-85 disabled:opacity-40"
              style={BUTTON_STYLE[action]}
            >
              {isCurrent && <CheckIcon />}
              {pending && !dialog ? "Записуємо…" : ACTION_META[action].label}
            </button>
          );
        })}
      </div>

      {error && !dialog && (
        <p
          className={`text-xs text-[color:var(--status-rejected-fg)] ${bare ? "text-right" : "mt-2"}`}
        >
          {error}
        </p>
      )}

      {dialog && (
        <DecisionDialog
          action={dialog}
          isRevision={isRevision}
          reason={reason}
          rejectionCode={rejectionCode}
          error={error}
          pending={pending}
          onReason={setReason}
          onCode={setRejectionCode}
          onCancel={closeDialog}
          onConfirm={confirmDialog}
        />
      )}
    </div>
  );
}

function DecisionDialog({
  action,
  isRevision,
  reason,
  rejectionCode,
  error,
  pending,
  onReason,
  onCode,
  onCancel,
  onConfirm,
}: {
  action: DecisionAction;
  isRevision: boolean;
  reason: string;
  rejectionCode: RejectionCode | "";
  error: string | null;
  pending: boolean;
  onReason: (value: string) => void;
  onCode: (value: RejectionCode | "") => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-line bg-paper-raised p-5 shadow-xl">
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
          {action === "rejected" ? "Відхилити ідею" : "Змінити рішення на «прийнято»"}
        </h3>

        <div className="flex flex-col gap-3">
          {action === "rejected" && (
            <label className="flex flex-col gap-1 text-sm text-ink-dim">
              {"Код відмови (обов'язково)"}
              <select
                value={rejectionCode}
                onChange={(event) => onCode(event.target.value as RejectionCode | "")}
                className="rounded-md border border-line bg-paper px-2 py-1.5 text-sm text-ink"
              >
                <option value="">— обери код —</option>
                {REJECTION_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code} — {REJECTION_META[code]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm text-ink-dim">
            {action === "rejected"
              ? "Причина (обов'язково — піде в деталі відмови)"
              : "Чому міняєш рішення (обов'язково)"}
            <textarea
              ref={field}
              value={reason}
              onChange={(event) => onReason(event.target.value)}
              rows={4}
              placeholder="Коротко поясни рішення — піде в хронологію подій"
              className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </label>

          {isRevision && action === "rejected" && (
            <p className="text-xs text-ink-dim">
              Ідея вже має рішення — цей запис перекриє попереднє.
            </p>
          )}

          {error && <p className="text-xs text-[color:var(--status-rejected-fg)]">{error}</p>}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="rounded-md border border-line px-3 py-2 text-sm text-ink-dim hover:border-line-strong hover:text-ink disabled:opacity-40"
            >
              Скасувати
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="rounded-md px-3 py-2 text-sm font-medium transition-opacity hover:opacity-85 disabled:opacity-40"
              style={
                action === "accepted"
                  ? BUTTON_STYLE.accepted
                  : {
                      backgroundColor: "var(--status-rejected-fg)",
                      color: "var(--status-rejected-bg)",
                    }
              }
            >
              {pending ? "Записуємо…" : ACTION_META[action].label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
