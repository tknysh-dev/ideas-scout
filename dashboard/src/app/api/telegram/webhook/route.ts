import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";
const MAX_BODY_BYTES = 256 * 1024;
const NUDGE_DELAY_MS = 10 * 60 * 1000;

interface JobInsert {
  type: "telegram_update" | "telegram_nudge";
  payload: Record<string, unknown>;
  requested_by: "telegram:webhook";
  idempotency_key: string;
  available_at: string;
}

function hasValidSecret(request: NextRequest, expected: string) {
  const provided = request.headers.get(SECRET_HEADER);
  if (!provided) return false;
  const actualBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function isTelegramUpdate(value: unknown): value is Record<string, unknown> & { update_id: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger((value as Record<string, unknown>).update_id)
  );
}

function needsNudge(update: Record<string, unknown>) {
  const message = update.message;
  if (!message || typeof message !== "object") return false;
  const text = (message as Record<string, unknown>).text;
  return typeof text !== "string" || !text.trimStart().startsWith("/");
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ ok: false, error: "Webhook is not configured" }, { status: 503 });
  }
  if (!hasValidSecret(request, expectedSecret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large" }, { status: 413 });
  }

  let update: unknown;
  try {
    update = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!isTelegramUpdate(update)) {
    return NextResponse.json({ ok: false, error: "Invalid Telegram update" }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Database is not configured" }, { status: 503 });
  }

  const receivedAt = Date.now();
  // Усі об'єкти batch insert мають однаковий набір колонок. Інакше PostgREST
  // трактує відсутній available_at як NULL замість database default, а колонка
  // jobs.available_at має NOT NULL constraint — звичайні повідомлення давали 503.
  const jobs: JobInsert[] = [
    {
      type: "telegram_update",
      payload: { update },
      requested_by: "telegram:webhook",
      idempotency_key: `telegram-update:${update.update_id}`,
      available_at: new Date(receivedAt).toISOString(),
    },
  ];
  if (needsNudge(update)) {
    jobs.push({
      type: "telegram_nudge",
      payload: {},
      requested_by: "telegram:webhook",
      idempotency_key: `telegram-nudge:${update.update_id}`,
      available_at: new Date(receivedAt + NUDGE_DELAY_MS).toISOString(),
    });
  }

  const { data, error } = await supabase.from("jobs").insert(jobs).select("id,type");
  if (error?.code === "23505") {
    // Telegram повторює доставку, якщо не побачив 2xx. Унікальний update_id робить
    // повтор безпечним: подія вже в черзі, тож підтверджуємо її без другого запуску.
    return NextResponse.json({ ok: true, duplicate: true });
  }
  if (error) {
    // Payload і секрет навмисно не логуємо; code/message достатньо для Vercel Logs.
    console.error("Telegram webhook enqueue failed", {
      updateId: update.update_id,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json({ ok: false, error: "Could not enqueue update" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, jobs: data });
}
