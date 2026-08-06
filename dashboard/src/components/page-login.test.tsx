// Тестує src/app/login/page.tsx (LoginPage + локальна LoginError) —
// розгалуження за configured (getAuthEnv), server action кнопки входу й
// повідомлення про помилку OAuth-редіректу. Той самий підхід, що й у
// page-home.test.tsx: викликаємо серверні компоненти напряму як функції й
// обходимо повернене дерево React-елементів без монтування в DOM.
//
// LoginError — локальна async-функція без export (сторінка експортує лише
// default LoginPage). Дістати її саму по собі не можна через import, але
// React-елемент, який LoginPage будує для <LoginError .../>, несе в полі
// .type те саме посилання на функцію — той самий прийом, що й для будь-якого
// іменованого компонента, лише пошук за el.type.name замість імпортованого
// символу.
const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock("@/auth", () => ({ signIn }));

const { getAuthEnv } = vi.hoisted(() => ({ getAuthEnv: vi.fn() }));
vi.mock("@/lib/config", () => ({
  getAuthEnv,
  AUTH_VARS: ["AUTH_SECRET", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET", "ALLOWED_GITHUB_LOGIN"],
}));

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import LoginPage from "@/app/login/page";
import ConfigNotice from "@/components/ConfigNotice";

function collectAll(node: unknown, out: ReactElement[] = []): ReactElement[] {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collectAll(n, out);
    return out;
  }
  const el = node as ReactElement;
  out.push(el);
  const children = (el.props as { children?: ReactNode } | null)?.children;
  if (children !== undefined) collectAll(children, out);
  return out;
}

function findByType<P = { children?: ReactNode }>(node: unknown, type: unknown): ReactElement<P>[] {
  return collectAll(node).filter((el) => el.type === type) as ReactElement<P>[];
}

function findLoginError(node: unknown): ReactElement<{ searchParams: Promise<{ error?: string }> }> | undefined {
  return collectAll(node).find(
    (el) => typeof el.type === "function" && el.type.name === "LoginError",
  ) as ReactElement<{ searchParams: Promise<{ error?: string }> }> | undefined;
}

const AUTH_ENV = { secret: "s", clientId: "id", clientSecret: "cs", allowedLogin: "octocat" };

beforeEach(() => {
  signIn.mockReset();
  getAuthEnv.mockReset();
});

describe("configured (getAuthEnv() заповнено)", () => {
  beforeEach(() => getAuthEnv.mockReturnValue(AUTH_ENV));

  test("рендерить форму входу, без ConfigNotice", () => {
    const el = LoginPage({ searchParams: Promise.resolve({}) });
    expect(findByType(el, ConfigNotice)).toHaveLength(0);
    expect(findByType(el, "form")).toHaveLength(1);
  });

  test("кнопка форми викликає server action -> signIn('github', { redirectTo: '/' })", async () => {
    const el = LoginPage({ searchParams: Promise.resolve({}) });
    const form = findByType<{ action: () => Promise<void> }>(el, "form")[0];
    await form.props.action();
    expect(signIn).toHaveBeenCalledWith("github", { redirectTo: "/" });
  });

  test("searchParams без error -> LoginError резолвиться в null", async () => {
    const el = LoginPage({ searchParams: Promise.resolve({}) });
    const loginError = findLoginError(el);
    expect(loginError).toBeDefined();
    const rendered = await (loginError!.type as (props: { searchParams: Promise<{ error?: string }> }) => Promise<ReactElement | null>)(
      loginError!.props,
    );
    expect(rendered).toBeNull();
  });

  test("searchParams.error === 'AccessDenied' -> повідомлення про акаунт без доступу", async () => {
    const el = LoginPage({ searchParams: Promise.resolve({ error: "AccessDenied" }) });
    const loginError = findLoginError(el);
    const rendered = await (loginError!.type as (props: { searchParams: Promise<{ error?: string }> }) => Promise<ReactElement | null>)(
      loginError!.props,
    );
    const text = String((rendered!.props as { children?: ReactNode })?.children);
    expect(text).toContain("не має доступу");
  });

  test("searchParams.error поза словником -> загальне повідомлення про невдалий вхід", async () => {
    const el = LoginPage({ searchParams: Promise.resolve({ error: "SomethingWeird" }) });
    const loginError = findLoginError(el);
    const rendered = await (loginError!.type as (props: { searchParams: Promise<{ error?: string }> }) => Promise<ReactElement | null>)(
      loginError!.props,
    );
    const text = String((rendered!.props as { children?: ReactNode })?.children);
    expect(text).toContain("Не вдалося завершити вхід");
  });
});

describe("не configured (getAuthEnv() === null)", () => {
  beforeEach(() => getAuthEnv.mockReturnValue(null));

  test("рендерить ConfigNotice з переліком AUTH_VARS, форми немає", () => {
    const el = LoginPage({ searchParams: Promise.resolve({}) });
    const notices = findByType<{ title: string; vars: string[] }>(el, ConfigNotice);
    expect(notices).toHaveLength(1);
    expect(notices[0].props.title).toBe("Авторизацію не налаштовано");
    expect(notices[0].props.vars).toEqual([
      "AUTH_SECRET",
      "AUTH_GITHUB_ID",
      "AUTH_GITHUB_SECRET",
      "ALLOWED_GITHUB_LOGIN",
    ]);
    expect(findByType(el, "form")).toHaveLength(0);
  });
});
