"use client";

import { useState, useTransition } from "react";
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
  rejected: { label: "Відхилити", hint: "Обов'язково вкажи код і причину" },
};

export default function DecisionPanel({
  ideaId,
  currentStatus,
  compact = false,
  onDecided,
}: {
  ideaId: string;
  currentStatus: IdeaStatus;
  compact?: boolean;
  onDecided?: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [rejectionCode, setRejectionCode] = useState<RejectionCode | "">("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DecisionAction | null>(null);

  // Рішення вже ухвалене — панель тепер переглядає його, а не виносить уперше.
  const isRevision = currentStatus !== "approved_pending";

  function submit(action: DecisionAction) {
    setError(null);
    setDone(null);
    if (action === "rejected" && (!reason.trim() || !rejectionCode)) {
      setError("Для відхилення обов'язково вкажи причину і код відмови.");
      return;
    }
    if (isRevision && !reason.trim()) {
      setError("Зміна вже ухваленого рішення вимагає причини.");
      return;
    }
    startTransition(async () => {
      const result = await decideIdea({
        ideaId,
        action,
        reason,
        rejectionCode: action === "rejected" ? rejectionCode : undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(action);
      setReason("");
      setRejectionCode("");
      onDecided?.();
      router.refresh();
    });
  }

  return (
    <div
      className={`rounded-lg border border-line bg-paper-raised ${compact ? "p-4" : "p-5"}`}
    >
      {!compact && (
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
          {isRevision ? "Змінити рішення" : "Твоє рішення"}
        </h2>
      )}

      {done && (
        <p className="mb-3 text-sm text-ink-dim">
          Рішення записано: {ACTION_META[done].label.toLowerCase()}.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink-dim">
          {isRevision ? "Чому (обов'язково)" : "Чому (обов'язково для відхилення)"}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={compact ? 2 : 3}
            placeholder="Коротко поясни рішення — піде в events.reason"
            className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink-dim">
          Код відмови (лише для «Відхилити»)
          <select
            value={rejectionCode}
            onChange={(e) => setRejectionCode(e.target.value as RejectionCode | "")}
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

        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(ACTION_META) as DecisionAction[]).map((action) => {
            // «Відхилити» лишається активним і на відхиленій ідеї — так міняють
            // код відмови, не проводячи запис через проміжний статус.
            const isCurrent = action === currentStatus && action !== "rejected";
            return (
              <button
                key={action}
                type="button"
                disabled={pending || isCurrent}
                onClick={() => submit(action)}
                title={isCurrent ? "Поточний статус" : ACTION_META[action].hint}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-40 ${
                  action === "rejected"
                    ? "border border-[color:var(--status-rejected-fg)] text-[color:var(--status-rejected-fg)] hover:opacity-80"
                    : "bg-accent text-accent-ink hover:opacity-90"
                }`}
              >
                {pending ? "Записуємо…" : ACTION_META[action].label}
              </button>
            );
          })}
          {isRevision && (
            <span className="text-xs text-ink-dim">
              зараз: {statusMeta(currentStatus).label.toLowerCase()}
            </span>
          )}
        </div>

        {error && <p className="text-xs text-[color:var(--status-rejected-fg)]">{error}</p>}
      </div>
    </div>
  );
}
