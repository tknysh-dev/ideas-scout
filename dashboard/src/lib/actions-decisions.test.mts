// Накриває сам server action decideIdea() у src/lib/actions/decisions.ts —
// раніше покривалась лише винесена логіка (decisions-logic.ts), а обгортка
// (перевірка сесії/allow-list, послідовність запитів до Supabase, помилки
// кожного кроку) — ні (0% покриття).
//
// actions/decisions.ts імпортується напряму через ESM-хук
// actions-decisions.hooks.mjs, без жодної зміни самого actions/decisions.ts.
// Хук підміняє лише резолюцію імпортів (auth, supabase-клієнт, revalidatePath),
// щоб не піднімати NextAuth і не ходити в мережу. Див. коментар у хуку.

import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { register } from "node:module";

register("./actions-decisions.hooks.mjs", import.meta.url);

const { mockState, resetMockService } = await import("./actions-test-mock-service.mts");
const { mockAuthState, resetMockAuth } = await import("./actions-decisions.mock-auth.mts");
const { mockCacheState, resetMockCache } = await import("./actions-test-mock-next-cache.mts");
const { decideIdea } = await import("./actions/decisions.ts");

const AUTH_VARS = ["AUTH_SECRET", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "ALLOWED_GITHUB_LOGIN"] as const;
// NODE_ENV у типах Next.js — readonly (next/types/global.d.ts), тому пряме
// присвоєння mutableEnv.NODE_ENV = ... не компілюється. Обхід лише для
// тесту: process.env лишається тим самим обʼєктом рантайму.
const mutableEnv = process.env as Record<string, string | undefined>;
const savedEnv: Record<string, string | undefined> = { NODE_ENV: mutableEnv.NODE_ENV };
for (const key of AUTH_VARS) savedEnv[key] = mutableEnv[key];

function setAuthEnv(allowedLogin = "owner-login") {
  mutableEnv.AUTH_SECRET = "secret";
  mutableEnv.AUTH_GITHUB_ID = "id";
  mutableEnv.AUTH_GITHUB_SECRET = "secret";
  mutableEnv.ALLOWED_GITHUB_LOGIN = allowedLogin;
}

function clearAuthEnv() {
  for (const key of AUTH_VARS) delete mutableEnv[key];
}

beforeEach(() => {
  resetMockService();
  resetMockAuth();
  resetMockCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete mutableEnv[key];
    else mutableEnv[key] = value;
  }
});

const validAccept = { ideaId: "PI-001", action: "accepted" as const, reason: "" };

// --- assertOwner: гілки перевірки авторизації -----------------------------

test("decideIdea: немає auth env, NODE_ENV=development -> авторизацію пропускає", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.queue = [
    { data: { id: "PI-001", status: "approved_pending", rejection_code: null }, error: null },
    { error: null },
    { error: null },
  ];
  const result = await decideIdea(validAccept);
  assert.deepEqual(result, {});
});

test("decideIdea: немає auth env, NODE_ENV не development -> «Авторизацію не налаштовано.»", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "production";
  const result = await decideIdea(validAccept);
  assert.equal(result.error, "Авторизацію не налаштовано.");
});

test("decideIdea: auth env є, немає сесії -> «Потрібен вхід у дашборд.»", async () => {
  setAuthEnv();
  mockAuthState.session = null;
  const result = await decideIdea(validAccept);
  assert.equal(result.error, "Потрібен вхід у дашборд.");
});

test("decideIdea: сесія є, логін не в allow-list -> доступ заборонено", async () => {
  setAuthEnv("owner-login");
  mockAuthState.session = { user: { login: "someone-else" } };
  const result = await decideIdea(validAccept);
  assert.equal(result.error, "Цей акаунт не має доступу до рішень власника.");
});

test("decideIdea: сесія і логін співпадають -> дія триває далі", async () => {
  setAuthEnv("owner-login");
  mockAuthState.session = { user: { login: "owner-login" } };
  mockState.queue = [
    { data: { id: "PI-001", status: "approved_pending", rejection_code: null }, error: null },
    { error: null },
    { error: null },
  ];
  const result = await decideIdea(validAccept);
  assert.deepEqual(result, {});
});

// --- decideIdea: гілки після проходження авторизації ----------------------

test("decideIdea: невалідний input -> помилка валідації, Supabase не викликається", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  const result = await decideIdea({ ideaId: "PI-001", action: "postponed" as never, reason: "" });
  assert.equal(result.error, "Невідома дія.");
  assert.equal(mockState.calls.length, 0);
});

// Симетрично з fetchDeepResearchPrompt/loadResearchableIdea в actions/deep-research.ts:
// формат ideaId звіряється з IDEA_ID_RE до будь-якого звернення в базу.
test("decideIdea: ideaId не відповідає формату -> помилка валідації, Supabase не викликається", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  const result = await decideIdea({ ideaId: "'; drop table ideas;--", action: "accepted", reason: "" });
  assert.equal(result.error, "Некоректний ID ідеї.");
  assert.equal(mockState.calls.length, 0);
});

test("decideIdea: валідний input, немає доступу до бази -> «Немає доступу до бази.»", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.clientAvailable = false;
  const result = await decideIdea(validAccept);
  assert.equal(result.error, "Немає доступу до бази.");
});

test("decideIdea: помилка читання ідеї -> повідомлення з текстом Supabase", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.queue = [{ data: null, error: { message: "connection reset" } }];
  const result = await decideIdea(validAccept);
  assert.equal(result.error, "Помилка читання ідеї: connection reset");
});

test("decideIdea: ідею не знайдено (data і error порожні) -> «Ідею не знайдено.»", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.queue = [{ data: null, error: null }];
  const result = await decideIdea(validAccept);
  assert.equal(result.error, "Ідею не знайдено.");
});

test("decideIdea: перехід статусу заборонено (та сама дія без зміни коду) -> помилка переходу, update не викликається", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.queue = [
    { data: { id: "PI-001", status: "accepted", rejection_code: null }, error: null },
  ];
  // reason непорожній, бо для current !== "approved_pending" isRevision === true,
  // а без причини спрацював би інший guard ("Зміна вже ухваленого рішення...").
  const result = await decideIdea({ ideaId: "PI-001", action: "accepted", reason: "передумав" });
  assert.equal(result.error, "Ідея вже в статусі «Прийнята».");
  assert.ok(!mockState.calls.some((c) => c.method === "update"));
});

test("decideIdea: перегляд без причини -> «Зміна вже ухваленого рішення вимагає причини.»", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.queue = [
    { data: { id: "PI-001", status: "accepted", rejection_code: null }, error: null },
  ];
  const result = await decideIdea(validAccept);
  assert.equal(result.error, "Зміна вже ухваленого рішення вимагає причини.");
});

test("decideIdea: помилка оновлення статусу -> повідомлення з текстом Supabase, подія не пишеться", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.queue = [
    { data: { id: "PI-001", status: "approved_pending", rejection_code: null }, error: null },
    { error: { message: "write failed" } },
  ];
  const result = await decideIdea(validAccept);
  assert.equal(result.error, "Помилка оновлення статусу: write failed");
  assert.ok(!mockState.calls.some((c) => c.table === "events"));
});

test("decideIdea: статус оновлено, але подію записати не вдалось -> часткова помилка", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.queue = [
    { data: { id: "PI-001", status: "approved_pending", rejection_code: null }, error: null },
    { error: null },
    { error: { message: "events table locked" } },
  ];
  const result = await decideIdea(validAccept);
  assert.equal(result.error, "Статус оновлено, але подію не записано: events table locked");
});

test("decideIdea: повний успіх -> порожній результат і revalidatePath('/', 'layout')", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.queue = [
    { data: { id: "PI-001", status: "approved_pending", rejection_code: null }, error: null },
    { error: null },
    { error: null },
  ];
  const result = await decideIdea(validAccept);
  assert.deepEqual(result, {});
  assert.deepEqual(mockCacheState.calls, [["/", "layout"]]);
});

test("decideIdea: перегляд ухваленого рішення (rejected -> accepted) скидає поля відмови", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  mockState.queue = [
    { data: { id: "PI-001", status: "rejected", rejection_code: "LEGAL" }, error: null },
    { error: null },
    { error: null },
  ];
  const result = await decideIdea({ ideaId: "PI-001", action: "accepted", reason: "передумав" });
  assert.deepEqual(result, {});
  const update = mockState.calls.find((c) => c.method === "update" && c.table === "ideas");
  assert.deepEqual(update?.args[0], {
    status: "accepted",
    rejection_code: null,
    rejection_detail: null,
    rejection_other_reason: null,
    rejection_codes_extra: [],
  });
});
