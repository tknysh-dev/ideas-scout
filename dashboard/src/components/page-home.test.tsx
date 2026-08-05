// Тестує src/app/page.tsx (HomePage) — розбір searchParams (track/status/sort),
// а не сам рендер: сторінка — асинхронна функція без хуків, тож викликаємо її
// напряму й обходимо повернене дерево React-елементів (без монтування в DOM).
// Дочірні компоненти (IdeaTree, TreeFilters, EmptyState) імпортуються по-справжньому
// — React.createElement їх не виконує, тож жодних побічних ефектів немає, а
// знайти потрібний елемент можна порівнянням element.type із самим компонентом.
// Мокаємо лише Supabase; buildIdeaTree (@/lib/tree) лишається реальним —
// логіка фільтра/сортування вже накрита tree.test.mts, тут перевіряємо
// саме проведення параметрів запиту до неї.
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentType, ReactElement, ReactNode } from "react";

const { getServiceClient } = vi.hoisted(() => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient }));

import HomePage from "@/app/page";
import IdeaTree from "@/components/IdeaTree";
import TreeFilters from "@/components/TreeFilters";
import EmptyState from "@/components/EmptyState";
import ConfigNotice from "@/components/ConfigNotice";
import type { Idea } from "@/lib/types";

function idea(overrides: Partial<Idea> & { id: string }): Idea {
  return {
    track: "passive-income",
    parent_id: null,
    title: overrides.id,
    type: "niche",
    discovered: "2026-01-01",
    signal_type: "income_claim",
    monetization_hypothesis: null,
    mentions_count: 1,
    claimed_revenue: null,
    mechanic_summary: null,
    status: "new",
    rejection_code: null,
    rejection_detail: null,
    rejection_codes_extra: [],
    missing_capabilities: [],
    ceiling_estimate: null,
    launch_effort_hours: null,
    ceiling_flag: null,
    review_condition: null,
    review_count: 0,
    last_reviewed: null,
    min_review_interval_days: 0,
    confidence: null,
    transferred_to: null,
    verdict_provider: null,
    verdict_model: null,
    verdict_run_id: null,
    research_depth: "initial",
    deep_researched_at: null,
    deep_research_run_id: null,
    schema_version: 1,
    criteria_version: null,
    body: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Idea;
}

// P виводиться з ComponentType<P> самого компонента (напр. ConfigNotice ->
// {title, vars}) — окремо генерик у місцях виклику вказувати не треба.
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

function mockSupabase(trackRows: { track: string }[], ideasResult: { data: Idea[] | null; error: { message: string } | null }) {
  const from = vi.fn();
  from.mockReturnValueOnce({ select: vi.fn(async () => ({ data: trackRows })) });
  from.mockReturnValueOnce({ select: () => ({ eq: async () => ideasResult }) });
  return { from };
}

beforeEach(() => {
  getServiceClient.mockReset();
});

test("немає доступу до бази -> ConfigNotice, запитів не було", async () => {
  getServiceClient.mockReturnValue(null);
  const el = await HomePage({ searchParams: Promise.resolve({}) });
  expect(findByType(el, ConfigNotice)).toHaveLength(1);
});

test("помилка запиту Supabase -> ConfigNotice з текстом помилки", async () => {
  getServiceClient.mockReturnValue(
    mockSupabase([], { data: null, error: { message: "щось не так" } }),
  );
  const el = await HomePage({ searchParams: Promise.resolve({}) });
  const notice = findByType(el, ConfigNotice);
  expect(notice).toHaveLength(1);
  expect(notice[0].props.title).toContain("щось не так");
});

describe("розбір searchParams", () => {
  const IDEAS = [
    idea({ id: "A", status: "new", discovered: "2026-01-01" }),
    idea({ id: "B", status: "accepted", discovered: "2026-01-05" }),
  ];

  test("без track у params -> береться перший доступний трек (availableTracks[0])", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: IDEAS, error: null }));
    await HomePage({ searchParams: Promise.resolve({}) });
    const supabase = getServiceClient.mock.results[0].value;
    expect(supabase.from).toHaveBeenNthCalledWith(2, "ideas");
  });

  test("без status у params (undefined) -> statuses=null -> усі статуси проходять, IdeaTree бачить обидва вузли", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: IDEAS, error: null }));
    const el = await HomePage({ searchParams: Promise.resolve({ track: "passive-income" }) });
    const tree = findByType(el, IdeaTree);
    expect(tree).toHaveLength(1);
    expect(tree[0].props.nodes.map((n: { id: string }) => n.id).sort()).toEqual(["A", "B"]);
  });

  test("status='' (усі галочки зняті) -> statuses=[] -> жоден статус не проходить -> EmptyState із hint про фільтр", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: IDEAS, error: null }));
    const el = await HomePage({
      searchParams: Promise.resolve({ track: "passive-income", status: "" }),
    });
    expect(findByType(el, IdeaTree)).toHaveLength(0);
    const empty = findByType(el, EmptyState);
    expect(empty).toHaveLength(1);
    expect(empty[0].props.hint).toContain("фільтр за статусом");
  });

  test("status='accepted' -> лишається лише вузол зі статусом accepted", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: IDEAS, error: null }));
    const el = await HomePage({
      searchParams: Promise.resolve({ track: "passive-income", status: "accepted" }),
    });
    const tree = findByType(el, IdeaTree);
    expect(tree[0].props.nodes.map((n: { id: string }) => n.id)).toEqual(["B"]);
  });

  test("status='new,accepted' -> розбирається через кому, обидва проходять", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: IDEAS, error: null }));
    const el = await HomePage({
      searchParams: Promise.resolve({ track: "passive-income", status: "new,accepted" }),
    });
    const tree = findByType(el, IdeaTree);
    expect(tree[0].props.nodes.map((n: { id: string }) => n.id).sort()).toEqual(["A", "B"]);
  });

  test("невалідний статус у списку (не існуючий) -> просто не збігається з жодною ідеєю, без помилки", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: IDEAS, error: null }));
    const el = await HomePage({
      searchParams: Promise.resolve({ track: "passive-income", status: "not-a-real-status" }),
    });
    expect(findByType(el, IdeaTree)).toHaveLength(0);
  });

  test("sort='asc' -> передається в buildIdeaTree, дерево не падає", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: IDEAS, error: null }));
    const el = await HomePage({
      searchParams: Promise.resolve({ track: "passive-income", sort: "asc" }),
    });
    expect(findByType(el, IdeaTree)).toHaveLength(1);
  });

  test("будь-яке значення sort, крім 'asc' -> трактується як 'desc'", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: IDEAS, error: null }));
    const el = await HomePage({
      searchParams: Promise.resolve({ track: "passive-income", sort: "garbage" }),
    });
    // непряма перевірка: сторінка не падає й повертає дерево з обома вузлами
    const tree = findByType(el, IdeaTree);
    expect(tree[0].props.nodes).toHaveLength(2);
  });

  test("порожній результат для треку -> EmptyState без натяку на фільтр статусу (statuses===null)", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: [], error: null }));
    const el = await HomePage({ searchParams: Promise.resolve({ track: "app-ideas" }) });
    const empty = findByType(el, EmptyState);
    expect(empty).toHaveLength(1);
    expect(empty[0].props.hint).toContain("збирач або власник");
  });

  test("availableTracks завжди містить DEFAULT_TRACKS навіть без жодної ідеї в базі", async () => {
    getServiceClient.mockReturnValue(mockSupabase([], { data: [], error: null }));
    const el = await HomePage({ searchParams: Promise.resolve({}) });
    const filters = findByType(el, TreeFilters);
    expect(filters[0].props.tracks).toEqual(["passive-income", "app-ideas"]);
  });

  test("треки з бази, яких немає в DEFAULT_TRACKS, додаються до списку", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase([{ track: "passive-income" }, { track: "new-track" }], { data: [], error: null }),
    );
    const el = await HomePage({ searchParams: Promise.resolve({}) });
    const filters = findByType(el, TreeFilters);
    expect(filters[0].props.tracks).toEqual(["passive-income", "app-ideas", "new-track"]);
    expect(filters[0].props.counts).toEqual({ "passive-income": 1, "new-track": 1 });
  });
});
