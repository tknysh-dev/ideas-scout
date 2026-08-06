// owner.server.ts лежить у src/lib/, але цей файл живе тут: vitest.config.mts
// підхоплює лише src/components/**/*.test.tsx (src/lib/*.test.mts зарезервовано
// за node --test, який не вміє vi.mock) — інакше файл просто не запускався б
// через `npm test`. Мокаємо "server-only" (маркер), "@/auth" (сесія) і
// "@/lib/config" (env) — сама ownerLogin() виконується по-справжньому.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));

const { getAuthEnv } = vi.hoisted(() => ({ getAuthEnv: vi.fn() }));
vi.mock("@/lib/config", () => ({ getAuthEnv }));

import { ownerLogin } from "@/lib/owner.server";

const AUTH_ENV = { secret: "s", clientId: "id", clientSecret: "cs", allowedLogin: "octocat" };
const mutableEnv = process.env as Record<string, string | undefined>;
let savedNodeEnv: string | undefined;

beforeEach(() => {
  auth.mockReset();
  getAuthEnv.mockReset();
  savedNodeEnv = mutableEnv.NODE_ENV;
});

afterEach(() => {
  mutableEnv.NODE_ENV = savedNodeEnv;
});

describe("ownerLogin — авторизацію не налаштовано (getAuthEnv() === null)", () => {
  test("NODE_ENV=development -> дозволяє як 'dev', сесію не перевіряє", async () => {
    getAuthEnv.mockReturnValue(null);
    mutableEnv.NODE_ENV = "development";
    await expect(ownerLogin()).resolves.toEqual({ login: "dev" });
    expect(auth).not.toHaveBeenCalled();
  });

  test("NODE_ENV=production -> помилка конфігурації", async () => {
    getAuthEnv.mockReturnValue(null);
    mutableEnv.NODE_ENV = "production";
    await expect(ownerLogin()).resolves.toEqual({ error: "Авторизацію не налаштовано." });
    expect(auth).not.toHaveBeenCalled();
  });

  test("NODE_ENV не задано -> той самий шлях, що й production (не 'dev')", async () => {
    getAuthEnv.mockReturnValue(null);
    delete mutableEnv.NODE_ENV;
    await expect(ownerLogin()).resolves.toEqual({ error: "Авторизацію не налаштовано." });
  });
});

describe("ownerLogin — авторизацію налаштовано", () => {
  beforeEach(() => getAuthEnv.mockReturnValue(AUTH_ENV));

  test("немає сесії (auth() -> null) -> вимагає входу", async () => {
    auth.mockResolvedValue(null);
    await expect(ownerLogin()).resolves.toEqual({ error: "Потрібен вхід у дашборд." });
  });

  test("сесія без user -> вимагає входу", async () => {
    auth.mockResolvedValue({});
    await expect(ownerLogin()).resolves.toEqual({ error: "Потрібен вхід у дашборд." });
  });

  test("login з сесії не збігається з allowedLogin -> заборона", async () => {
    auth.mockResolvedValue({ user: { login: "intruder" } });
    await expect(ownerLogin()).resolves.toEqual({
      error: "Цей акаунт не має права створювати завдання.",
    });
  });

  test("login збігається з allowedLogin -> успіх, повертає login", async () => {
    auth.mockResolvedValue({ user: { login: "octocat" } });
    await expect(ownerLogin()).resolves.toEqual({ login: "octocat" });
  });

  // GitHub логіни регістронезалежні на своєму боці — порівняння тут теж має
  // ігнорувати регістр.
  test("порівняння регістронезалежне: 'Octocat' === 'octocat' -> успіх", async () => {
    auth.mockResolvedValue({ user: { login: "Octocat" } });
    await expect(ownerLogin()).resolves.toEqual({ login: "Octocat" });
  });

  test("порівняння регістронезалежне і в іншу сторону: allowedLogin у верхньому регістрі -> успіх", async () => {
    getAuthEnv.mockReturnValue({ ...AUTH_ENV, allowedLogin: "OCTOCAT" });
    auth.mockResolvedValue({ user: { login: "octocat" } });
    await expect(ownerLogin()).resolves.toEqual({ login: "octocat" });
  });
});
