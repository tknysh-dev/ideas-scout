// Тестує src/app/decisions/page.tsx (DecisionsPage) — вибірку approved_pending
// і стани помилок/порожнечі, не сам рендер: викликаємо асинхронну функцію
// напряму й обходимо повернене дерево React-елементів без монтування в DOM
// (той самий підхід, що й у page-home.test.tsx).
//
// Card (через FieldGroup/DecisionPanel не використовується тут напряму, але
// DecisionsPage сама рендерить <Card as="li">) тягне idea-refs.server.ts ->
// "server-only"; той модуль тут не під тестом, тож маркер нейтралізуємо (як у
// page-runs.test.tsx), а не мокаємо всю логіку Card.
vi.mock("server-only", () => ({}));

// DecisionPanel тягне decideIdea ("use server" -> @/auth -> next-auth), а
// next-auth в цьому репо не резолвиться в тестовому середовищі (той самий
// фікс, що й у DecisionPanel.test.tsx / IdeaOptionsMenu.test.tsx).
vi.mock("@/lib/actions/decisions", () => ({ decideIdea: vi.fn() }));

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentType, ReactElement, ReactNode } from "react";

const { getServiceClient } = vi.hoisted(() => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient }));

import DecisionsPage from "@/app/decisions/page";
import Card from "@/components/Card";
import ConfigNotice from "@/components/ConfigNotice";
import DecisionPanel from "@/components/DecisionPanel";
import EmptyState from "@/components/EmptyState";
import StatusBadge from "@/components/StatusBadge";
import Link from "next/link";
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
    status: "approved_pending",
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

function mockSupabase(result: { data: Idea[] | null; error: { message: string } | null }) {
  const eq = vi.fn(() => ({ order: vi.fn(async () => result) }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq };
}

beforeEach(() => {
  getServiceClient.mockReset();
});

test("немає доступу до бази -> ConfigNotice, запиту не було", async () => {
  getServiceClient.mockReturnValue(null);
  const el = await DecisionsPage();
  expect(findByType(el, ConfigNotice)).toHaveLength(1);
});

test("помилка запиту Supabase -> ConfigNotice з текстом помилки", async () => {
  const supabase = mockSupabase({ data: null, error: { message: "розрив з'єднання" } });
  getServiceClient.mockReturnValue(supabase);
  const el = await DecisionsPage();
  const notice = findByType(el, ConfigNotice);
  expect(notice).toHaveLength(1);
  expect(notice[0].props.title).toContain("розрив з'єднання");
});

test("запит фільтрує саме approved_pending і сортує за discovered desc", async () => {
  const supabase = mockSupabase({ data: [], error: null });
  getServiceClient.mockReturnValue(supabase);
  await DecisionsPage();
  expect(supabase.from).toHaveBeenCalledWith("ideas");
  expect(supabase.eq).toHaveBeenCalledWith("status", "approved_pending");
});

test("порожній список -> EmptyState, без переліку карток", async () => {
  const supabase = mockSupabase({ data: [], error: null });
  getServiceClient.mockReturnValue(supabase);
  const el = await DecisionsPage();
  expect(findByType(el, EmptyState)).toHaveLength(1);
  expect(findByType(el, Card)).toHaveLength(0);
});

test("data === null (без помилки) трактується як порожній список -> EmptyState", async () => {
  const supabase = mockSupabase({ data: null, error: null });
  getServiceClient.mockReturnValue(supabase);
  const el = await DecisionsPage();
  expect(findByType(el, EmptyState)).toHaveLength(1);
});

describe("непорожній список", () => {
  const IDEAS = [
    idea({ id: "A", title: "Ідея А", mechanic_summary: "коротко про А" }),
    idea({ id: "B", title: "Ідея Б", mechanic_summary: null }),
  ];

  test("кожна ідея -> Card+Link+StatusBadge+DecisionPanel(compact)", async () => {
    const supabase = mockSupabase({ data: IDEAS, error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await DecisionsPage();

    expect(findByType(el, Card)).toHaveLength(2);

    const links = findByType(el, Link).filter((l) => String(l.props.href).startsWith("/ideas/"));
    expect(links.map((l) => l.props.href)).toEqual(["/ideas/A", "/ideas/B"]);

    const badges = findByType(el, StatusBadge);
    expect(badges).toHaveLength(2);
    expect(badges[0].props.status).toBe("approved_pending");

    const panels = findByType(el, DecisionPanel);
    expect(panels).toHaveLength(2);
    expect(panels[0].props).toMatchObject({ ideaId: "A", currentStatus: "approved_pending", compact: true });
  });

  test("mechanic_summary відсутній (null) -> абзац з описом не рендериться", async () => {
    const supabase = mockSupabase({ data: [idea({ id: "B", mechanic_summary: null })], error: null });
    getServiceClient.mockReturnValue(supabase);
    const el = await DecisionsPage();
    const card = findByType(el, Card)[0];
    const texts: string[] = [];
    (function collect(node: unknown) {
      if (typeof node === "string") texts.push(node);
      else if (Array.isArray(node)) node.forEach(collect);
      else if (node && typeof node === "object") {
        const children = (node as ReactElement<{ children?: ReactNode }>).props?.children;
        if (children !== undefined) collect(children);
      }
    })(card.props.children);
    expect(texts.some((t) => t.includes("коротко про"))).toBe(false);
  });
});
