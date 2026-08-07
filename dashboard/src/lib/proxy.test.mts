// Накриває сам гейт авторизації — src/proxy.ts, функцію, яку Next викликає
// на кожен запит. Раніше покриття було 0%: тестувалась лише винесена чиста
// логіка (auth-logic.test.mts), а сам proxy.ts — ні. Коментарі у proxy.ts
// фіксують дві минулі поломки саме цього файлу: відсутність env колись
// пускала всіх, і файл у корені проєкту Next не реєструвався, тож гейт не
// виконувався жодного разу. Обидва випадки покриті нижче.
//
// proxy.ts імпортується напряму через ESM-хук proxy.hooks.mjs, без жодної
// зміни самого proxy.ts. Хук підміняє резолюцію "@/auth" (на керований
// дублер — щоб не будувати справжній NextAuth() з GitHub-провайдером),
// "@/lib/config"/"@/lib/auth-logic" (plain Node не знає tsconfig-alias
// "@/*") і розширення "next/server". Той самий прийом, що й у
// telegram-webhook-route.test.mts.
//
// proxy.ts вирішує ОДИН раз при імпорті модуля, який з двох хендлерів
// (gate/unconfigured) стане default-експортом (`getAuthEnv() ? gate :
// unconfigured`). Щоб перевірити обидві гілки, кожен виклик importProxy()
// імпортує модуль наново з іншим query-рядком — це обходить кеш ESM-модулів
// Node і форсує повторне виконання top-level коду з актуальним env.

import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { register } from "node:module";

register("./proxy.hooks.mjs", import.meta.url);

// Next захоплює globalThis.AsyncLocalStorage РІВНО ОДИН раз — на етапі
// обчислення свого модуля server/app-render/async-local-storage:
//
//   const maybeGlobalAsyncLocalStorage = ... && globalThis.AsyncLocalStorage;
//
// Якщо в ту мить глобала немає, Next назавжди підставляє FakeAsyncLocalStorage,
// чиї run()/enterWith() кидають «Invariant: AsyncLocalStorage accessed in
// runtime where it is not available». У справжньому Next-рантаймі глобал є, у
// plain Node — ні, тому ставимо його самі.
//
// Робити це треба ДО першого імпорту будь-чого з next — тому рядок стоїть тут,
// вище за `await import("next/server")`. Раніше присвоєння жило всередині
// тестів config.matcher, тобто вже після цього імпорту, і не встигало: знімок
// був зроблений з Fake-реалізацією. Проявлялось це підступно — усі перевірки
// проходили, а інваріант кидався з асинхронної активності Next уже ПІСЛЯ
// завершення тесту, тож node --test зараховував провал не тесту, а всього
// файлу, з повідомленням «resource generated asynchronous activity after the
// test ended» і без жодної вказівки на справжню причину.
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= (
  await import("node:async_hooks")
).AsyncLocalStorage;

const { mockAuthState, resetMockAuth } = await import("./proxy.mock-auth.mts");
const { NextRequest } = await import("next/server");

type ProxyHandler = (request: InstanceType<typeof NextRequest>) => Promise<Response> | Response;

const AUTH_VARS = ["AUTH_SECRET", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "ALLOWED_GITHUB_LOGIN"] as const;
const ALLOWED_LOGIN = "owner-login";

// NODE_ENV у типах Next.js — readonly, тому process.env.NODE_ENV = ... не
// компілюється; process.env лишається тим самим обʼєктом рантайму (як у
// config.test.mts).
const mutableEnv = process.env as Record<string, string | undefined>;
const saved: Record<string, string | undefined> = {};

function setConfiguredEnv() {
  process.env.AUTH_SECRET = "s3cr3t";
  process.env.AUTH_GITHUB_ID = "client-id";
  process.env.AUTH_GITHUB_SECRET = "client-secret";
  process.env.ALLOWED_GITHUB_LOGIN = ALLOWED_LOGIN;
}

function clearAuthEnv() {
  for (const key of AUTH_VARS) delete mutableEnv[key];
}

beforeEach(() => {
  for (const key of [...AUTH_VARS, "NODE_ENV"]) saved[key] = mutableEnv[key];
  resetMockAuth();
});

afterEach(() => {
  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = saved[key];
  }
});

let cacheBust = 0;
async function importProxy(): Promise<ProxyHandler> {
  cacheBust += 1;
  const mod = await import(`../proxy.ts?t=${cacheBust}`);
  return mod.default;
}

function req(pathname: string) {
  return new NextRequest(`http://localhost${pathname}`);
}

function isRedirectTo(res: Response, pathname: string) {
  if (res.status < 300 || res.status >= 400) return false;
  const location = res.headers.get("location");
  return location !== null && new URL(location).pathname === pathname;
}

// --- gate: env заповнено -------------------------------------------------

test("gate: публічний шлях /login без сесії проходить (не редіректить)", async () => {
  setConfiguredEnv();
  const gate = await importProxy();
  const res = await gate(req("/login"));
  assert.equal(isRedirectTo(res, "/login"), false);
});

test("gate: публічний шлях /api/auth/callback без сесії проходить", async () => {
  setConfiguredEnv();
  const gate = await importProxy();
  const res = await gate(req("/api/auth/callback/github"));
  assert.equal(res.status, 200);
});

test("gate: публічний шлях /api/telegram/webhook без сесії проходить", async () => {
  setConfiguredEnv();
  const gate = await importProxy();
  const res = await gate(req("/api/telegram/webhook"));
  assert.equal(res.status, 200);
});

test("gate: непублічний шлях без сесії -> редірект на /login", async () => {
  setConfiguredEnv();
  const gate = await importProxy();
  const res = await gate(req("/decisions"));
  assert.equal(isRedirectTo(res, "/login"), true);
});

test("gate: непублічний шлях із валідною сесією (allow-list) проходить", async () => {
  setConfiguredEnv();
  mockAuthState.session = { user: { login: ALLOWED_LOGIN } };
  const gate = await importProxy();
  const res = await gate(req("/decisions"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
});

test("gate: сесія є, але логін не з allow-list -> редірект на /login", async () => {
  setConfiguredEnv();
  mockAuthState.session = { user: { login: "intruder" } };
  const gate = await importProxy();
  const res = await gate(req("/decisions"));
  assert.equal(isRedirectTo(res, "/login"), true);
});

test("gate: шлях, що лише ПОЧИНАЄТЬСЯ як публічний (/loginX), не публічний -> редірект без сесії", async () => {
  setConfiguredEnv();
  const gate = await importProxy();
  const res = await gate(req("/loginX"));
  assert.equal(isRedirectTo(res, "/login"), true);
});

test("gate: валідна сесія на /login -> редірект на / (вже увійшов, логін-сторінка зайва)", async () => {
  setConfiguredEnv();
  mockAuthState.session = { user: { login: ALLOWED_LOGIN } };
  const gate = await importProxy();
  const res = await gate(req("/login"));
  assert.equal(isRedirectTo(res, "/"), true);
});

// --- unconfigured: env не заповнено --------------------------------------
// Це та сама поломка, що вже була: відсутність AUTH_* колись пускала всіх.
// Fail closed мусить триматись — у production закриваємо все, крім
// публічного; у development пускаємо все, щоб можна було працювати без
// OAuth-застосунку.

test("unconfigured: env не заповнені, NODE_ENV=development -> пускає непублічний шлях", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "development";
  const handler = await importProxy();
  const res = await handler(req("/decisions"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("location"), null);
});

test("unconfigured: env не заповнені, NODE_ENV=production -> публічний /login проходить", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "production";
  const handler = await importProxy();
  const res = await handler(req("/login"));
  assert.equal(res.status, 200);
});

test("unconfigured: env не заповнені, NODE_ENV=production -> непублічний шлях редіректить на /login (fail closed)", async () => {
  clearAuthEnv();
  mutableEnv.NODE_ENV = "production";
  const handler = await importProxy();
  const res = await handler(req("/decisions"));
  assert.equal(isRedirectTo(res, "/login"), true);
});

test("unconfigured: бракує лише ALLOWED_GITHUB_LOGIN (решта задані), NODE_ENV=production -> усе одно fail closed", async () => {
  setConfiguredEnv();
  delete mutableEnv.ALLOWED_GITHUB_LOGIN;
  mutableEnv.NODE_ENV = "production";
  const handler = await importProxy();
  const res = await handler(req("/decisions"));
  assert.equal(isRedirectTo(res, "/login"), true);
});

// --- config.matcher -------------------------------------------------------
// Саме тут гейт колись не виконувався жодного разу (proxy.ts у корені
// проєкту замість src/ — middleware-manifest.json лишався порожнім). Тут
// перевіряємо іншу половину того самого ризику: що matcher реально включає
// сторінки/API, які мають бути захищені, і виключає лише статику.
// unstable_doesMiddlewareMatch — той самий движок, яким Next вирішує, чи
// запускати proxy на даному URL (next/experimental/testing/server,
// задокументовано в node_modules/next/dist/docs/.../proxy.md).

test("config.matcher: покриває сторінки й API, які мають бути захищені", async () => {
  // globalThis.AsyncLocalStorage підставлено на початку файлу — саме заради
  // цього імпорту (next/experimental/testing/server тягне server/web/exports).
  const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server");
  const { config } = await import(`../proxy.ts?t=matcher-${cacheBust++}`);

  const mustMatch = ["/", "/login", "/decisions", "/ideas/123", "/api/auth/callback/github", "/api/telegram/webhook"];
  for (const pathname of mustMatch) {
    assert.equal(
      unstable_doesMiddlewareMatch({ config, url: `http://localhost${pathname}` }),
      true,
      `matcher мусить покривати ${pathname}`,
    );
  }
});

test("config.matcher: виключає лише статику (_next/static, _next/image, favicon.ico)", async () => {
  const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server");
  const { config } = await import(`../proxy.ts?t=matcher-${cacheBust++}`);

  const mustNotMatch = ["/_next/static/chunk.js", "/_next/image?url=x", "/favicon.ico"];
  for (const pathname of mustNotMatch) {
    assert.equal(
      unstable_doesMiddlewareMatch({ config, url: `http://localhost${pathname}` }),
      false,
      `matcher не мусить покривати ${pathname}`,
    );
  }
});
