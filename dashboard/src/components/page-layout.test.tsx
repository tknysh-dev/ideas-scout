// Тестує src/app/layout.tsx (RootLayout) — підрахунок рішень, що чекають
// (getPendingDecisionsCount), і проброс authDisabled у Sidebar; не сам
// рендер: викликаємо асинхронну функцію напряму й обходимо повернене дерево
// React-елементів без монтування в DOM (той самий підхід, що й у
// page-home.test.tsx / page-decisions.test.tsx).
//
// next/font/google у прод-коді підмінюється SWC-плагіном Next.js під час
// збірки; сам пакет поза цим пайплайном кидає помилку одразу при імпорті
// (node_modules/next/font/google/index.js: "@next/font/google failed to run
// or is incorrectly configured"), тож тут його мокаємо простими об'єктами.
vi.mock("next/font/google", () => ({
  Alegreya: () => ({ variable: "--font-display" }),
  IBM_Plex_Mono: () => ({ variable: "--font-mono" }),
  IBM_Plex_Sans: () => ({ variable: "--font-sans" }),
}));

// Sidebar тягне @/lib/actions/session -> @/auth -> next-auth, який у
// тестовому середовищі цього репо не резолвиться (той самий фікс, що й у
// Sidebar.test.tsx): підміняємо саму серверну дію заглушкою.
vi.mock("@/lib/actions/session", () => ({ logout: vi.fn() }));

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentType, ReactElement, ReactNode } from "react";

const { getServiceClient } = vi.hoisted(() => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient }));

const { getAuthEnv } = vi.hoisted(() => ({ getAuthEnv: vi.fn() }));
vi.mock("@/lib/config", () => ({ getAuthEnv }));

import RootLayout from "@/app/layout";
import Sidebar from "@/components/Sidebar";
import PageShell from "@/components/PageShell";

// P виводиться з ComponentType<P> самого компонента — окремо генерик у місцях
// виклику вказувати не треба.
function findByType<P = { children?: ReactNode }>(
  node: unknown,
  type: ComponentType<P> | string,
  out: ReactElement<P>[] = [],
): ReactElement<P>[] {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) findByType<P>(n, type, out);
    return out;
  }
  const el = node as ReactElement<P>;
  if (el.type === type) out.push(el);
  const children = (el.props as { children?: ReactNode } | null)?.children;
  if (children !== undefined) findByType<P>(children, type, out);
  return out;
}

const AUTH_ENV = { secret: "s", clientId: "id", clientSecret: "cs", allowedLogin: "octocat" };

function mockSupabase(result: { count: number | null; error: { message: string } | null }) {
  const eq = vi.fn(async () => result);
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq };
}

beforeEach(() => {
  getServiceClient.mockReset();
  getAuthEnv.mockReset();
  getAuthEnv.mockReturnValue(AUTH_ENV);
});

test("клієнта немає (getServiceClient -> null) -> pendingDecisions=0, запиту до бази не було", async () => {
  getServiceClient.mockReturnValue(null);
  const el = await RootLayout({ children: <div>вміст</div> });
  const sidebar = findByType(el, Sidebar);
  expect(sidebar).toHaveLength(1);
  expect(sidebar[0].props.pendingDecisions).toBe(0);
});

test("успішний запит -> фільтр по approved_pending і кількість передається у Sidebar", async () => {
  const supabase = mockSupabase({ count: 5, error: null });
  getServiceClient.mockReturnValue(supabase);
  const el = await RootLayout({ children: <div /> });
  expect(supabase.from).toHaveBeenCalledWith("ideas");
  expect(supabase.eq).toHaveBeenCalledWith("status", "approved_pending");
  expect(findByType(el, Sidebar)[0].props.pendingDecisions).toBe(5);
});

test("нуль рішень (count: 0) -> Sidebar отримує 0, а не фолбек null/undefined", async () => {
  const supabase = mockSupabase({ count: 0, error: null });
  getServiceClient.mockReturnValue(supabase);
  const el = await RootLayout({ children: <div /> });
  expect(findByType(el, Sidebar)[0].props.pendingDecisions).toBe(0);
});

// Supabase-клієнт на мережеву/серверну помилку зазвичай РЕЗОЛВИТЬ проміс з
// { data: null, count: null, error: {...} }, а не реджектить його. layout.tsx
// error взагалі не перевіряє — лише `count ?? 0`, тож помилка тихо стає
// нулем: бейдж "рішень чекає" в Sidebar показує 0 замість реального стану.
// Портал у цьому випадку НЕ падає.
test("помилка Supabase (запит резолвиться з error, count: null) -> тихо трактується як 0, портал не падає", async () => {
  const supabase = mockSupabase({ count: null, error: { message: "розрив з'єднання" } });
  getServiceClient.mockReturnValue(supabase);
  const el = await RootLayout({ children: <div /> });
  expect(findByType(el, Sidebar)[0].props.pendingDecisions).toBe(0);
});

// ФІКСУЄМО РИЗИК (з опису завдання): getPendingDecisionsCount() не має
// try/catch навколо await. Якщо базовий HTTP-виклик супабейс-клієнта не
// резолвиться в об'єкт { error }, а РЕДЖЕКТИТЬ проміс (fetch кинув виняток,
// а не повернув відповідь з тілом-помилкою — саме так поводиться
// supabase-js, коли мережа справді недоступна, а не сервер відповів 4xx/5xx),
// виняток пробивається крізь RootLayout без обробки. Оскільки цей layout
// рендериться на КОЖНІЙ сторінці порталу, така відмова кладе весь портал
// повністю (Next.js покаже глобальний error boundary), а не тільки один
// віджет лічильника.
test("мережевий збій (проміс супабейс-запиту реджектиться) -> RootLayout кидає виняток, портал падає повністю", async () => {
  const eq = vi.fn(() => Promise.reject(new Error("fetch failed")));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  getServiceClient.mockReturnValue({ from });
  await expect(RootLayout({ children: <div /> })).rejects.toThrow("fetch failed");
});

describe("authDisabled у Sidebar", () => {
  test("getAuthEnv() === null -> authDisabled=true", async () => {
    getAuthEnv.mockReturnValue(null);
    getServiceClient.mockReturnValue(null);
    const el = await RootLayout({ children: <div /> });
    expect(findByType(el, Sidebar)[0].props.authDisabled).toBe(true);
  });

  test("getAuthEnv() заповнено -> authDisabled=false", async () => {
    getAuthEnv.mockReturnValue(AUTH_ENV);
    getServiceClient.mockReturnValue(null);
    const el = await RootLayout({ children: <div /> });
    expect(findByType(el, Sidebar)[0].props.authDisabled).toBe(false);
  });
});

test("children рендериться всередині PageShell", async () => {
  getServiceClient.mockReturnValue(null);
  const el = await RootLayout({ children: <span>унікальний-вміст</span> });
  const shells = findByType(el, PageShell);
  expect(shells).toHaveLength(1);
  expect(shells[0].props.children).toEqual(<span>унікальний-вміст</span>);
});
