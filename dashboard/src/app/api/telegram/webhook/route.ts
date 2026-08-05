import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/service";
import {
  MAX_BODY_BYTES,
  SECRET_HEADER,
  buildJobs,
  chatIdOf,
  hasValidSecret,
  isTelegramUpdate,
} from "@/lib/telegram-webhook";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const ownerChatId = process.env.TELEGRAM_CHAT_ID;
  if (!expectedSecret || !ownerChatId) {
    return NextResponse.json({ ok: false, error: "Webhook is not configured" }, { status: 503 });
  }
  if (!hasValidSecret(request.headers.get(SECRET_HEADER), expectedSecret)) {
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

  // Чужі апдейти відсіюємо тут, а не у воркері: інакше будь-хто, хто знайшов бота
  // за юзернеймом, наповнює чергу job'ами. 200 — щоб Telegram не ретраїв доставку.
  if (chatIdOf(update) !== ownerChatId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Database is not configured" }, { status: 503 });
  }

  const jobs = buildJobs(update, Date.now());

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
