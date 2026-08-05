// Накриває сам хендлер POST у app/api/telegram/webhook/route.ts — периметр
// системи, куди приходять неавтентифіковані запити з інтернету. Раніше була
// накрита лише винесена логіка (telegram-webhook.ts), а відповіді самого
// route (коди статусів, гілки помилок) — ні.
//
// route.ts імпортується напряму через ESM-хук telegram-webhook-route.hooks.mjs,
// без жодної зміни самого route.ts. Хук підміняє лише резолюцію імпортів:
// getServiceClient (щоб не ходити в мережу й не падати на "server-only") і
// розширення "next/server" (потрібне плейн Node, але не Next.js бандлеру).
// Див. коментар у самому хуку.

import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { register } from "node:module";

register("./telegram-webhook-route.hooks.mjs", import.meta.url);

const { mockState, resetMockService } = await import("./telegram-webhook-route.mock-service.mts");
const { SECRET_HEADER, MAX_BODY_BYTES } = await import("./telegram-webhook.ts");
const { POST } = await import("../app/api/telegram/webhook/route.ts");
const { NextRequest } = await import("next/server");

const SECRET = "test-secret-token";
const OWNER_CHAT_ID = "555555";

const savedEnv = {
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
};

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.TELEGRAM_CHAT_ID = OWNER_CHAT_ID;
  resetMockService();
});

afterEach(() => {
  if (savedEnv.TELEGRAM_WEBHOOK_SECRET === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
  else process.env.TELEGRAM_WEBHOOK_SECRET = savedEnv.TELEGRAM_WEBHOOK_SECRET;
  if (savedEnv.TELEGRAM_CHAT_ID === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = savedEnv.TELEGRAM_CHAT_ID;
});

function postRequest(body: string, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function ownerUpdate(updateId: number, text = "/start") {
  return {
    update_id: updateId,
    message: { chat: { id: Number(OWNER_CHAT_ID) }, text },
  };
}

test("POST: немає env (TELEGRAM_WEBHOOK_SECRET/TELEGRAM_CHAT_ID) -> 503", async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_CHAT_ID;
  const res = await POST(postRequest("{}"));
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.ok, false);
});

test("POST: невірний секрет -> 401", async () => {
  const res = await POST(postRequest("{}", { [SECRET_HEADER]: "wrong-secret" }));
  assert.equal(res.status, 401);
});

test("POST: відсутній заголовок секрету -> 401", async () => {
  const res = await POST(postRequest("{}"));
  assert.equal(res.status, 401);
});

test("POST: content-length більший за ліміт -> 413", async () => {
  const res = await POST(
    postRequest("{}", {
      [SECRET_HEADER]: SECRET,
      "content-length": String(MAX_BODY_BYTES + 1),
    }),
  );
  assert.equal(res.status, 413);
});

test("POST: тіло більше за ліміт без заголовка content-length -> 413", async () => {
  const oversizedBody = JSON.stringify({ update_id: 1, padding: "x".repeat(MAX_BODY_BYTES + 100) });
  const res = await POST(postRequest(oversizedBody, { [SECRET_HEADER]: SECRET }));
  assert.equal(res.status, 413);
});

test("POST: невалідний JSON -> 400", async () => {
  const res = await POST(postRequest("{not json", { [SECRET_HEADER]: SECRET }));
  assert.equal(res.status, 400);
});

test("POST: не Telegram-update (без update_id) -> 400", async () => {
  const res = await POST(postRequest(JSON.stringify({ message: { text: "hi" } }), { [SECRET_HEADER]: SECRET }));
  assert.equal(res.status, 400);
});

test("POST: чужий chat_id -> 200 з ignored (не 4xx/5xx, щоб Telegram не ретраїв)", async () => {
  const foreignUpdate = { update_id: 2, message: { chat: { id: 999999 }, text: "hi" } };
  const res = await POST(postRequest(JSON.stringify(foreignUpdate), { [SECRET_HEADER]: SECRET }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, { ok: true, ignored: true });
  assert.equal(mockState.lastInsertedRows, null, "чужий апдейт не мусить діставатись до insert");
});

test("POST: немає клієнта Supabase (getServiceClient() === null) -> 503", async () => {
  mockState.clientAvailable = false;
  const res = await POST(postRequest(JSON.stringify(ownerUpdate(3)), { [SECRET_HEADER]: SECRET }));
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.ok, false);
});

test("POST: помилка вставки з code 23505 (дублікат) -> 200 з duplicate", async (t) => {
  t.mock.method(console, "error", () => {});
  mockState.insertResult = { data: null, error: { code: "23505", message: "duplicate key" } };
  const res = await POST(postRequest(JSON.stringify(ownerUpdate(4)), { [SECRET_HEADER]: SECRET }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, { ok: true, duplicate: true });
});

test("POST: інша помилка БД (не 23505) -> 503", async (t) => {
  t.mock.method(console, "error", () => {});
  mockState.insertResult = { data: null, error: { code: "500XX", message: "boom" } };
  const res = await POST(postRequest(JSON.stringify(ownerUpdate(5)), { [SECRET_HEADER]: SECRET }));
  assert.equal(res.status, 503);
  const json = await res.json();
  assert.equal(json.ok, false);
});

test("POST: успіх -> 200 з job'ами, вставленими рядками для правильного update", async () => {
  const rows = [{ id: "job-1", type: "telegram_update" }];
  mockState.insertResult = { data: rows, error: null };
  const update = ownerUpdate(6, "привіт");
  const res = await POST(postRequest(JSON.stringify(update), { [SECRET_HEADER]: SECRET }));
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, { ok: true, jobs: rows });
  assert.ok(Array.isArray(mockState.lastInsertedRows));
  assert.equal(mockState.lastInsertedRows?.length, 2, "звичайне повідомлення дає update+nudge job");
  assert.equal((mockState.lastInsertedRows as { idempotency_key: string }[])[0].idempotency_key, "telegram-update:6");
});
