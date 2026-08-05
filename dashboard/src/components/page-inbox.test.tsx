// Тестує src/app/inbox/page.tsx (InboxPage) — стани помилки/порожнечі й
// розгалуження за полями InboxRow, не сам рендер: викликаємо асинхронну
// функцію напряму й обходимо повернене дерево React-елементів без монтування
// в DOM (той самий підхід, що й у page-home.test.tsx).
//
// InboxPage рендерить <Card as="li">, яка тягне idea-refs.server.ts ->
// "server-only"; той модуль тут не під тестом, тож маркер нейтралізуємо (як у
// page-runs.test.tsx).
vi.mock("server-only", () => ({}));

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentType, ReactElement, ReactNode } from "react";

const { getServiceClient } = vi.hoisted(() => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient }));

import InboxPage from "@/app/inbox/page";
import Card from "@/components/Card";
import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import Link from "next/link";
import type { InboxRow } from "@/lib/types";

function row(overrides: Partial<InboxRow> & { id: number }): InboxRow {
  return {
    draft_id: null,
    submitted_at: "2026-01-01T00:00:00Z",
    raw_text: "текст ідеї",
    source: "telegram",
    track: null,
    mode: null,
    target_card_id: null,
    triage_status: null,
    triage_verdict: null,
    triage_score: null,
    idea_id: null,
    ...overrides,
  };
}

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

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object") {
    const children = (node as ReactElement<{ children?: ReactNode }>).props?.children;
    return children !== undefined ? textOf(children) : "";
  }
  return "";
}

function mockSupabase(result: { data: InboxRow[] | null; error: { message: string } | null }) {
  const order = vi.fn(async () => result);
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { from, select, order };
}

beforeEach(() => {
  getServiceClient.mockReset();
});

test("немає доступу до бази -> ConfigNotice, запиту не було", async () => {
  getServiceClient.mockReturnValue(null);
  const el = await InboxPage();
  expect(findByType(el, ConfigNotice)).toHaveLength(1);
});

test("помилка запиту Supabase -> ConfigNotice з текстом помилки", async () => {
  const supabase = mockSupabase({ data: null, error: { message: "тайм-аут" } });
  getServiceClient.mockReturnValue(supabase);
  const el = await InboxPage();
  const notice = findByType(el, ConfigNotice);
  expect(notice).toHaveLength(1);
  expect(notice[0].props.title).toContain("тайм-аут");
});

test("запит сортує за submitted_at desc", async () => {
  const supabase = mockSupabase({ data: [], error: null });
  getServiceClient.mockReturnValue(supabase);
  await InboxPage();
  expect(supabase.from).toHaveBeenCalledWith("inbox");
  expect(supabase.order).toHaveBeenCalledWith("submitted_at", { ascending: false });
});

test("порожній список -> EmptyState", async () => {
  const supabase = mockSupabase({ data: [], error: null });
  getServiceClient.mockReturnValue(supabase);
  const el = await InboxPage();
  expect(findByType(el, EmptyState)).toHaveLength(1);
  expect(findByType(el, Card)).toHaveLength(0);
});

test("data === null (без помилки) трактується як порожній список -> EmptyState", async () => {
  const supabase = mockSupabase({ data: null, error: null });
  getServiceClient.mockReturnValue(supabase);
  const el = await InboxPage();
  expect(findByType(el, EmptyState)).toHaveLength(1);
});

describe("розгалуження за полями InboxRow", () => {
  test("draft_id відсутній (null) -> показується #id", async () => {
    const supabase = mockSupabase({ data: [row({ id: 42, draft_id: null })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).toContain("#42");
  });

  test("draft_id присутній -> показується він, а не #id", async () => {
    const supabase = mockSupabase({ data: [row({ id: 42, draft_id: "d-7" })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    const text = textOf(card.props.children);
    expect(text).toContain("d-7");
    expect(text).not.toContain("#42");
  });

  test("track відсутній -> без бейджа треку", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, track: null })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).not.toContain("Пасивний дохід");
  });

  test("track присутній -> trackLabel показує людську назву", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, track: "passive-income" })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).toContain("Пасивний дохід");
  });

  test("track поза словником -> trackLabel повертає значення як є", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, track: "мій-новий-трек" })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).toContain("мій-новий-трек");
  });

  test("triage_status='rejected' -> тон відхилення (TRIAGE_TONE)", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, triage_status: "rejected" })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    const span = findByType<{ className?: string; children?: ReactNode }>(card, "span").find(
      (s) => textOf(s.props.children) === "rejected",
    );
    expect(span?.props.className).toContain("status-rejected-fg");
  });

  test("triage_status поза словником TRIAGE_TONE -> фолбек text-ink-dim, без падіння", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, triage_status: "pending" })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    const span = findByType<{ className?: string; children?: ReactNode }>(card, "span").find(
      (s) => textOf(s.props.children) === "pending",
    );
    expect(span?.props.className).toContain("text-ink-dim");
  });

  test("triage_verdict відсутній -> блок вердикту тріажу не рендериться", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, triage_verdict: null })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).not.toContain("Вердикт тріажу");
  });

  test("triage_verdict присутній -> блок з текстом вердикту рендериться", async () => {
    const supabase = mockSupabase({
      data: [row({ id: 1, triage_verdict: "схвалено з умовою" })],
      error: null,
    });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    const text = textOf(card.props.children);
    expect(text).toContain("Вердикт тріажу");
    expect(text).toContain("схвалено з умовою");
  });

  // triage_score != null (нестроге порівняння): 0 — валідна оцінка, а не
  // "відсутнє значення", тож має показатись, а не зникнути як falsy.
  test("triage_score === 0 -> все одно показується (!= null, не falsy-перевірка)", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, triage_score: 0 })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).toContain("Оцінка: 0");
  });

  test("triage_score === null -> рядок оцінки не рендериться", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, triage_score: null })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).not.toContain("Оцінка:");
  });

  test("mode відсутній -> рядок режиму не рендериться", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, mode: null })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).not.toContain("Режим:");
  });

  test("mode присутній -> рядок режиму рендериться", async () => {
    const supabase = mockSupabase({ data: [row({ id: 1, mode: "manual" })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).toContain("Режим: manual");
  });

  test("idea_id присутній -> посилання 'Створена картка', target_card_id ігнорується навіть якщо теж є", async () => {
    const supabase = mockSupabase({
      data: [row({ id: 1, idea_id: "I-1", target_card_id: "I-2" })],
      error: null,
    });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    const links = findByType(card, Link);
    expect(links).toHaveLength(1);
    expect(links[0].props.href).toBe("/ideas/I-1");
    expect(textOf(links[0].props.children)).toContain("Створена картка");
  });

  test("idea_id відсутній, target_card_id присутній -> посилання 'Стосується картки'", async () => {
    const supabase = mockSupabase({
      data: [row({ id: 1, idea_id: null, target_card_id: "I-2" })],
      error: null,
    });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    const links = findByType(card, Link);
    expect(links).toHaveLength(1);
    expect(links[0].props.href).toBe("/ideas/I-2");
    expect(textOf(links[0].props.children)).toContain("Стосується картки");
  });

  test("ні idea_id, ні target_card_id -> без посилання на картку", async () => {
    const supabase = mockSupabase({
      data: [row({ id: 1, idea_id: null, target_card_id: null })],
      error: null,
    });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    const card = findByType(el, Card)[0];
    expect(findByType(card, Link)).toHaveLength(0);
  });

  test("кілька рядків -> Card для кожного, у порядку відповіді бази", async () => {
    const supabase = mockSupabase({
      data: [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })],
      error: null,
    });
    getServiceClient.mockReturnValue(supabase);
    const el = await InboxPage();
    expect(findByType(el, Card)).toHaveLength(3);
  });
});
