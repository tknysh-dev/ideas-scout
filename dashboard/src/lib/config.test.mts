import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { getAuthEnv, getConfigSource, getDataEnv, getGithubEnv } from "./config.ts";

const VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "AUTH_SECRET",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "ALLOWED_GITHUB_LOGIN",
  "CONFIG_SOURCE",
  "NODE_ENV",
  "GITHUB_TOKEN",
] as const;

const saved: Record<string, string | undefined> = {};

// NODE_ENV у типах Next.js — readonly (next/types/global.d.ts), тому пряме
// присвоєння process.env.NODE_ENV = ... не компілюється. Обхід лише для
// тесту: process.env лишається тим самим обʼєктом рантайму.
const mutableEnv = process.env as Record<string, string | undefined>;

beforeEach(() => {
  for (const key of VARS) {
    saved[key] = mutableEnv[key];
    delete mutableEnv[key];
  }
});

afterEach(() => {
  for (const key of VARS) {
    if (saved[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = saved[key];
  }
});

// --- getDataEnv --------------------------------------------------------

test("getDataEnv: обидва задані -> валідний обʼєкт", () => {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "secret-key";
  assert.deepEqual(getDataEnv(), { url: "https://x.supabase.co", key: "secret-key" });
});

test("getDataEnv: жодного не задано -> null", () => {
  assert.equal(getDataEnv(), null);
});

test("getDataEnv: задано лише URL -> null", () => {
  process.env.SUPABASE_URL = "https://x.supabase.co";
  assert.equal(getDataEnv(), null);
});

test("getDataEnv: задано лише ключ -> null", () => {
  process.env.SUPABASE_SERVICE_KEY = "secret-key";
  assert.equal(getDataEnv(), null);
});

test("getDataEnv: порожній рядок замість URL -> null (falsy)", () => {
  process.env.SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_KEY = "secret-key";
  assert.equal(getDataEnv(), null);
});

test("getDataEnv: значення з самих пробілів трактується як відсутнє -> null", () => {
  process.env.SUPABASE_URL = "   ";
  process.env.SUPABASE_SERVICE_KEY = "secret-key";
  assert.equal(getDataEnv(), null);
});

test("getDataEnv: значення з зайвими пробілами навколо валідного тексту трімиться", () => {
  process.env.SUPABASE_URL = "  https://x.supabase.co  ";
  process.env.SUPABASE_SERVICE_KEY = "secret-key";
  assert.deepEqual(getDataEnv(), { url: "https://x.supabase.co", key: "secret-key" });
});

// --- getAuthEnv ---------------------------------------------------------
// Найважливіший блок: getAuthEnv() — джерело для proxy.ts. Будь-яка
// відсутня змінна мусить fail-closed повернути null, інакше межа
// авторизації в проді пропустить усіх (unconfigured() -> "allow").

test("getAuthEnv: усі чотири задані -> валідний обʼєкт", () => {
  process.env.AUTH_SECRET = "s";
  process.env.AUTH_GITHUB_ID = "id";
  process.env.AUTH_GITHUB_SECRET = "cs";
  process.env.ALLOWED_GITHUB_LOGIN = "octocat";
  assert.deepEqual(getAuthEnv(), {
    secret: "s",
    clientId: "id",
    clientSecret: "cs",
    allowedLogin: "octocat",
  });
});

test("getAuthEnv: жодного не задано -> null", () => {
  assert.equal(getAuthEnv(), null);
});

for (const missing of ["AUTH_SECRET", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "ALLOWED_GITHUB_LOGIN"] as const) {
  test(`getAuthEnv: бракує лише ${missing} -> null (fail closed)`, () => {
    process.env.AUTH_SECRET = "s";
    process.env.AUTH_GITHUB_ID = "id";
    process.env.AUTH_GITHUB_SECRET = "cs";
    process.env.ALLOWED_GITHUB_LOGIN = "octocat";
    delete process.env[missing];
    assert.equal(getAuthEnv(), null);
  });
}

test("getAuthEnv: три з чотирьох задані, одного бракує (пара) -> null", () => {
  process.env.AUTH_SECRET = "s";
  process.env.AUTH_GITHUB_ID = "id";
  assert.equal(getAuthEnv(), null);
});

test("getAuthEnv: ALLOWED_GITHUB_LOGIN — порожній рядок -> null", () => {
  process.env.AUTH_SECRET = "s";
  process.env.AUTH_GITHUB_ID = "id";
  process.env.AUTH_GITHUB_SECRET = "cs";
  process.env.ALLOWED_GITHUB_LOGIN = "";
  assert.equal(getAuthEnv(), null);
});

test("getAuthEnv: значення з зайвими пробілами навколо allowedLogin трімиться", () => {
  process.env.AUTH_SECRET = "s";
  process.env.AUTH_GITHUB_ID = "id";
  process.env.AUTH_GITHUB_SECRET = "cs";
  process.env.ALLOWED_GITHUB_LOGIN = "  octocat  ";
  assert.deepEqual(getAuthEnv(), {
    secret: "s",
    clientId: "id",
    clientSecret: "cs",
    allowedLogin: "octocat",
  });
});

// Рядок із самих пробілів раніше проходив як "валідний" ALLOWED_GITHUB_LOGIN,
// який потім НІКОЛИ не збігався з реальним GitHub login — allow-list ефективно
// блокував усіх, мовчки. Тепер трактується так само, як відсутня змінна.
test("getAuthEnv: ALLOWED_GITHUB_LOGIN з самих пробілів -> null (fail closed)", () => {
  process.env.AUTH_SECRET = "s";
  process.env.AUTH_GITHUB_ID = "id";
  process.env.AUTH_GITHUB_SECRET = "cs";
  process.env.ALLOWED_GITHUB_LOGIN = "   ";
  assert.equal(getAuthEnv(), null);
});

// --- getConfigSource ------------------------------------------------------

test("getConfigSource: явний CONFIG_SOURCE=local перемагає незалежно від NODE_ENV", () => {
  process.env.CONFIG_SOURCE = "local";
  mutableEnv.NODE_ENV = "production";
  assert.equal(getConfigSource(), "local");
});

test("getConfigSource: явний CONFIG_SOURCE=github перемагає незалежно від NODE_ENV", () => {
  process.env.CONFIG_SOURCE = "github";
  mutableEnv.NODE_ENV = "development";
  assert.equal(getConfigSource(), "github");
});

test("getConfigSource: без CONFIG_SOURCE, NODE_ENV=development -> local", () => {
  mutableEnv.NODE_ENV = "development";
  assert.equal(getConfigSource(), "local");
});

test("getConfigSource: без CONFIG_SOURCE, NODE_ENV=production -> github", () => {
  mutableEnv.NODE_ENV = "production";
  assert.equal(getConfigSource(), "github");
});

test("getConfigSource: без CONFIG_SOURCE і без NODE_ENV -> github (фейл-безпечний бік)", () => {
  assert.equal(getConfigSource(), "github");
});

test("getConfigSource: сміттєве значення CONFIG_SOURCE ігнорується, рішення падає на NODE_ENV", () => {
  process.env.CONFIG_SOURCE = "prod";
  mutableEnv.NODE_ENV = "development";
  assert.equal(getConfigSource(), "local");
});

// --- getGithubEnv -----------------------------------------------------

test("getGithubEnv: токен заданий -> обʼєкт із фіксованими owner/repo/branch", () => {
  process.env.GITHUB_TOKEN = "ghp_xxx";
  assert.deepEqual(getGithubEnv(), {
    token: "ghp_xxx",
    owner: "tknysh-dev",
    repo: "ideas-scout",
    branch: "main",
  });
});

test("getGithubEnv: токен не заданий -> null", () => {
  assert.equal(getGithubEnv(), null);
});

test("getGithubEnv: порожній рядок замість токена -> null", () => {
  process.env.GITHUB_TOKEN = "";
  assert.equal(getGithubEnv(), null);
});

test("getGithubEnv: рядок із самих пробілів замість токена -> null", () => {
  process.env.GITHUB_TOKEN = "   ";
  assert.equal(getGithubEnv(), null);
});
