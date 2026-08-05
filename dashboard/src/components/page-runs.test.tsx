// Тестує src/app/runs/page.tsx (RunsPage) — розбір searchParams (tab/page) і
// пагінацію, не сам рендер: викликаємо асинхронну функцію напряму й обходимо
// повернене дерево React-елементів без монтування в DOM (див. коментар у
// page-home.test.tsx — той самий підхід і те саме обмеження vitest.config.mts
// на розташування файлу).
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentType, ReactElement, ReactNode } from "react";

// JobsTable/RunsTable рендерять Card, який тягне idea-refs.server.ts -> "server-only";
// той модуль тут не під тестом (накритий окремо idea-refs-server.test.tsx), тож
// маркер просто нейтралізуємо, а не мокаємо всю логіку.
vi.mock("server-only", () => ({}));

const { getServiceClient } = vi.hoisted(() => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient }));

import RunsPage from "@/app/runs/page";
import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import Pagination from "@/components/Pagination";
import Tabs from "@/components/Tabs";

// P виводиться з ComponentType<P> самого компонента (напр. Pagination ->
// {page, pageCount, ...}) — окремо генерик у місцях виклику вказувати не треба.
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

function mockSupabase({
  queueCount = 0,
  historyCount = 0,
  pageResult = { data: [], count: 0, error: null },
}: {
  queueCount?: number;
  historyCount?: number;
  pageResult?: { data: unknown[] | null; count: number | null; error: { message: string } | null };
}) {
  const from = vi.fn();
  from.mockReturnValueOnce({ select: async () => ({ count: queueCount }) });
  from.mockReturnValueOnce({ select: async () => ({ count: historyCount }) });
  from.mockReturnValueOnce({
    select: () => ({ order: () => ({ range: async () => pageResult }) }),
  });
  return { from };
}

beforeEach(() => {
  getServiceClient.mockReset();
});

test("немає доступу до бази -> ConfigNotice", async () => {
  getServiceClient.mockReturnValue(null);
  const el = await RunsPage({ searchParams: Promise.resolve({}) });
  expect(findByType(el, ConfigNotice)).toHaveLength(1);
});

describe("розбір tab", () => {
  test("без tab -> 'queue' активний за замовчуванням", async () => {
    getServiceClient.mockReturnValue(mockSupabase({}));
    const el = await RunsPage({ searchParams: Promise.resolve({}) });
    const tabs = findByType(el, Tabs);
    expect(tabs[0].props.active).toBe("queue");
  });

  test("tab='history' -> активний 'history'", async () => {
    getServiceClient.mockReturnValue(mockSupabase({}));
    const el = await RunsPage({ searchParams: Promise.resolve({ tab: "history" }) });
    const tabs = findByType(el, Tabs);
    expect(tabs[0].props.active).toBe("history");
  });

  test("довільне сміттєве значення tab -> падає на 'queue'", async () => {
    getServiceClient.mockReturnValue(mockSupabase({}));
    const el = await RunsPage({ searchParams: Promise.resolve({ tab: "garbage" }) });
    const tabs = findByType(el, Tabs);
    expect(tabs[0].props.active).toBe("queue");
  });

  test("лічильники обох табів завжди присутні, незалежно від активного", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ queueCount: 3, historyCount: 7 }));
    const el = await RunsPage({ searchParams: Promise.resolve({ tab: "history" }) });
    const tabs = findByType(el, Tabs);
    expect(tabs[0].props.items.map((i) => i.count)).toEqual([3, 7]);
  });
});

describe("розбір page (parsePage)", () => {
  const ROWS = [{ run_id: "1" }];

  test("без page -> сторінка 1", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: ROWS, count: 1, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({}) });
    expect(findByType(el, Pagination)[0].props.page).toBe(1);
  });

  test("page='3' -> сторінка 3", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: ROWS, count: 100, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({ page: "3" }) });
    expect(findByType(el, Pagination)[0].props.page).toBe(3);
  });

  test("page='0' -> невалідна (не > 0), fallback на 1", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: ROWS, count: 1, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({ page: "0" }) });
    expect(findByType(el, Pagination)[0].props.page).toBe(1);
  });

  test("page='-5' -> невалідна, fallback на 1", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: ROWS, count: 1, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({ page: "-5" }) });
    expect(findByType(el, Pagination)[0].props.page).toBe(1);
  });

  test("page='abc' (NaN) -> fallback на 1", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: ROWS, count: 1, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({ page: "abc" }) });
    expect(findByType(el, Pagination)[0].props.page).toBe(1);
  });

  // Number.parseInt("2.9", 10) === 2 — дробова частина обрізається, а не
  // округлюється й не відхиляється. Задокументовано як є.
  test("page='2.9' -> Number.parseInt обрізає до 2, а не округлює й не відхиляє", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: ROWS, count: 100, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({ page: "2.9" }) });
    expect(findByType(el, Pagination)[0].props.page).toBe(2);
  });

  // Number.parseInt("5abc", 10) === 5 — суфікс сміття ігнорується без помилки.
  test("page='5abc' -> parseInt читає числовий префікс, суфікс ігнорується", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: ROWS, count: 100, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({ page: "5abc" }) });
    expect(findByType(el, Pagination)[0].props.page).toBe(5);
  });

  test("pageCount рахується як Math.max(1, Math.ceil(total/PAGE_SIZE)) — total=0 -> pageCount=1", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: [], count: 0, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({}) });
    // total=0 і rows=[] -> рендериться EmptyState, а не Pagination
    expect(findByType(el, EmptyState)).toHaveLength(1);
    expect(findByType(el, Pagination)).toHaveLength(0);
  });

  test("total=41 -> pageCount=3 (20 на сторінку)", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: ROWS, count: 41, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({}) });
    expect(findByType(el, Pagination)[0].props.pageCount).toBe(3);
  });
});

describe("порожні й помилкові стани", () => {
  test("черга порожня -> EmptyState з підказкою про чергу", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: [], count: 0, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({ tab: "queue" }) });
    const empty = findByType(el, EmptyState);
    expect(empty[0].props.hint).toContain("worker на M1");
  });

  test("історія порожня -> EmptyState з підказкою про історію", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ pageResult: { data: [], count: 0, error: null } }));
    const el = await RunsPage({ searchParams: Promise.resolve({ tab: "history" }) });
    const empty = findByType(el, EmptyState);
    expect(empty[0].props.hint).toContain("тріажу");
  });

  test("pageResult.error -> ConfigNotice з текстом помилки, замінює таблицю", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ pageResult: { data: null, count: null, error: { message: "розрив з'єднання" } } }),
    );
    const el = await RunsPage({ searchParams: Promise.resolve({}) });
    const notice = findByType(el, ConfigNotice);
    expect(notice[0].props.title).toContain("розрив з'єднання");
  });
});
