import { timingSafeEqual } from "node:crypto";

export const SECRET_HEADER = "x-telegram-bot-api-secret-token";
export const MAX_BODY_BYTES = 256 * 1024;
export const NUDGE_DELAY_MS = 10 * 60 * 1000;

export interface JobInsert {
  type: "telegram_update" | "telegram_nudge";
  payload: Record<string, unknown>;
  requested_by: "telegram:webhook";
  idempotency_key: string;
  available_at: string;
}

export function hasValidSecret(providedHeader: string | null, expected: string) {
  if (!providedHeader) return false;
  const actualBuffer = Buffer.from(providedHeader);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function isTelegramUpdate(value: unknown): value is Record<string, unknown> & { update_id: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger((value as Record<string, unknown>).update_id)
  );
}

export function chatIdOf(update: Record<string, unknown>) {
  const container =
    update.message ??
    update.edited_message ??
    (update.callback_query as Record<string, unknown> | undefined)?.message;
  if (!container || typeof container !== "object") return null;
  const chat = (container as Record<string, unknown>).chat;
  if (!chat || typeof chat !== "object") return null;
  const id = (chat as Record<string, unknown>).id;
  return typeof id === "number" || typeof id === "string" ? String(id) : null;
}

export function needsNudge(update: Record<string, unknown>) {
  const message = update.message;
  if (!message || typeof message !== "object") return false;
  const text = (message as Record<string, unknown>).text;
  return typeof text !== "string" || !text.trimStart().startsWith("/");
}

export function buildJobs(update: Record<string, unknown> & { update_id: number }, receivedAtMs: number): JobInsert[] {
  // Усі об'єкти batch insert мають однаковий набір колонок. Інакше PostgREST
  // трактує відсутній available_at як NULL замість database default, а колонка
  // jobs.available_at має NOT NULL constraint — звичайні повідомлення давали 503.
  const jobs: JobInsert[] = [
    {
      type: "telegram_update",
      payload: { update },
      requested_by: "telegram:webhook",
      idempotency_key: `telegram-update:${update.update_id}`,
      available_at: new Date(receivedAtMs).toISOString(),
    },
  ];
  if (needsNudge(update)) {
    jobs.push({
      type: "telegram_nudge",
      payload: {},
      requested_by: "telegram:webhook",
      idempotency_key: `telegram-nudge:${update.update_id}`,
      available_at: new Date(receivedAtMs + NUDGE_DELAY_MS).toISOString(),
    });
  }
  return jobs;
}
