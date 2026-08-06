// CompetitorsSection обгортає кожен рядок у Card — асинхронний серверний
// компонент (тягне idea-refs.server.ts -> "server-only"). ReactDOM (client
// render) не вміє монтувати компоненти, що повертають Promise, тож замість
// render()+screen викликаємо CompetitorsSection напряму як функцію й обходимо
// повернене дерево React-елементів вручну — той самий підхід, що й у
// page-idea.test.tsx. Card/Pill лишаються нев'їханими елементами дерева: їх
// власна логіка тут не під тестом.
vi.mock("server-only", () => ({}));

import { describe, expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import CompetitorsSection from "./CompetitorsSection";
import Card from "./Card";
import Pill from "./Pill";
import { formatDate } from "@/lib/dates";
import { LIVENESS_META } from "@/lib/deep-research";
import type { CompetitorRow } from "@/lib/types";

function competitor(overrides: Partial<CompetitorRow> & { id: string; name: string }): CompetitorRow {
  return {
    idea_id: "I-1",
    run_id: null,
    url: null,
    pricing: null,
    liveness: null,
    last_activity: null,
    strengths: null,
    weaknesses: null,
    differentiation: null,
    evidence: null,
    created_at: "2026-01-01T00:00:00Z",
    superseded_at: null,
    ...overrides,
  };
}

function findByType<P = { children?: ReactNode }>(
  node: unknown,
  type: unknown,
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

function build(competitors: CompetitorRow[], ideaId?: string) {
  return CompetitorsSection({ competitors, ideaId });
}

describe("CompetitorsSection — порожній список", () => {
  test("competitors=[] -> компонент не рендерить нічого (null)", () => {
    expect(build([])).toBeNull();
  });
});

describe("CompetitorsSection — лічильник живучості", () => {
  test("мікс active/stale/dead/null -> кожен рахується у своєму кошику, null ігнорується", () => {
    const el = build([
      competitor({ id: "c1", name: "A", liveness: "active" }),
      competitor({ id: "c2", name: "B", liveness: "active" }),
      competitor({ id: "c3", name: "C", liveness: "stale" }),
      competitor({ id: "c4", name: "D", liveness: "dead" }),
      competitor({ id: "c5", name: "E", liveness: null }),
    ]);
    expect(textOf(el)).toContain("Живих: 2 · Застиглих: 1 · Мертвих: 1");
  });

  test("усі liveness відсутні -> усі три лічильники нульові", () => {
    const el = build([competitor({ id: "c1", name: "A" })]);
    expect(textOf(el)).toContain("Живих: 0 · Застиглих: 0 · Мертвих: 0");
  });

  test("невідоме значення liveness (не зі словника) -> рахується як «Невідомих», Pill рендериться з сирим значенням, компонент не падає", () => {
    const rows = [
      competitor({
        id: "c1",
        name: "Невідомий стан",
        liveness: "archived" as unknown as CompetitorRow["liveness"],
      }),
    ];
    expect(() => build(rows)).not.toThrow();
    const el = build(rows);
    expect(textOf(el)).toContain("Живих: 0 · Застиглих: 0 · Мертвих: 0 · Невідомих: 1");
    const pills = findByType(el, Pill);
    expect(pills).toHaveLength(1);
    expect(pills[0].props).toMatchObject({ label: "archived" });
  });

  test("liveness='active' -> Pill із міткою та токеном LIVENESS_META.active", () => {
    const el = build([competitor({ id: "c1", name: "A", liveness: "active" })]);
    const pills = findByType(el, Pill);
    expect(pills).toHaveLength(1);
    expect(pills[0].props).toMatchObject({
      label: LIVENESS_META.active.label,
      token: LIVENESS_META.active.token,
    });
  });
});

describe("CompetitorsSection — hasDetails (розкривна картка чи голий заголовок)", () => {
  test("усі опційні поля null і evidence порожній -> заголовок без <details>, без шеврона", () => {
    const el = build([competitor({ id: "c1", name: "Голий конкурент" })]);
    expect(findByType(el, "details")).toHaveLength(0);
    expect(findByType(el, "svg")).toHaveLength(0);
    expect(textOf(el)).toContain("Голий конкурент");
  });

  test("лише pricing задано -> hasDetails=true, <details> і шеврон присутні", () => {
    const el = build([competitor({ id: "c1", name: "З ціною", pricing: "$10/міс" })]);
    expect(findByType(el, "details")).toHaveLength(1);
    expect(findByType(el, "svg")).toHaveLength(1);
    expect(textOf(el)).toContain("$10/міс");
  });

  test("лише url задано -> hasDetails=true, посилання рендериться", () => {
    const el = build([competitor({ id: "c1", name: "З лінком", url: "https://rival.example" })]);
    const links = findByType<{ href?: string }>(el, "a");
    expect(links.some((a) => a.props.href === "https://rival.example")).toBe(true);
  });

  test("лише strengths задано -> hasDetails=true, блок 'Сильні сторони' з текстом", () => {
    const el = build([
      competitor({ id: "c1", name: "X", strengths: "гарний UX, швидкий онбординг" }),
    ]);
    expect(textOf(el)).toContain("Сильні сторони");
    expect(textOf(el)).toContain("гарний UX, швидкий онбординг");
  });

  test("лише weaknesses задано -> блок 'Слабкі місця' з текстом", () => {
    const el = build([competitor({ id: "c1", name: "X", weaknesses: "дорога підтримка" })]);
    expect(textOf(el)).toContain("Слабкі місця");
    expect(textOf(el)).toContain("дорога підтримка");
  });

  test("лише differentiation задано -> блок 'Кут відриву' з текстом", () => {
    const el = build([competitor({ id: "c1", name: "X", differentiation: "нижча ціна" })]);
    expect(textOf(el)).toContain("Кут відриву");
    expect(textOf(el)).toContain("нижча ціна");
  });

  test("лише evidence непорожній -> hasDetails=true без hasMeta/url/strengths/weaknesses/differentiation", () => {
    const el = build([
      competitor({ id: "c1", name: "X", evidence: [{ url: "https://ev.example" }] }),
    ]);
    expect(findByType(el, "details")).toHaveLength(1);
    const links = findByType<{ href?: string }>(el, "a");
    expect(links.some((a) => a.props.href === "https://ev.example")).toBe(true);
  });

  test("evidence — невалідний jsonb (не масив) -> parseEvidence повертає [], рахується як порожній", () => {
    const el = build([
      competitor({ id: "c1", name: "X", evidence: { not: "an array" } }),
    ]);
    expect(findByType(el, "details")).toHaveLength(0);
  });

  test("evidence — масив з невалідними записами (без url) -> усі відфільтровано, список не рендериться", () => {
    const el = build([
      competitor({
        id: "c1",
        name: "X",
        evidence: [{ no_url: true }, "просто рядок", 42, null],
      }),
    ]);
    expect(findByType(el, "details")).toHaveLength(0);
  });
});

describe("CompetitorsSection — мета-рядок (pricing / last_activity)", () => {
  test("тільки pricing -> рядок мети показує лише ціну, без 'Остання активність'", () => {
    const el = build([competitor({ id: "c1", name: "X", pricing: "$5" })]);
    expect(textOf(el)).toContain("$5");
    expect(textOf(el)).not.toContain("Остання активність");
  });

  test("тільки last_activity -> рядок мети показує лише дату через formatDate", () => {
    const el = build([
      competitor({ id: "c1", name: "X", last_activity: "2026-02-10T00:00:00Z" }),
    ]);
    expect(textOf(el)).toContain(`Остання активність: ${formatDate("2026-02-10T00:00:00Z")}`);
  });

  test("обидва задано -> обидва рядки в одному блоці мети", () => {
    const el = build([
      competitor({ id: "c1", name: "X", pricing: "$5", last_activity: "2026-02-10T00:00:00Z" }),
    ]);
    const text = textOf(el);
    expect(text).toContain("$5");
    expect(text).toContain("Остання активність");
  });

  test("обидва null -> hasMeta=false, блок мети відсутній навіть якщо картка розкривна через інше поле", () => {
    const el = build([competitor({ id: "c1", name: "X", strengths: "щось" })]);
    expect(textOf(el)).not.toContain("Остання активність");
  });
});

describe("CompetitorsSection — список доказів (evidence)", () => {
  test("один доказ із датою -> посилання і дата показані", () => {
    const el = build([
      competitor({
        id: "c1",
        name: "X",
        evidence: [{ url: "https://a.example", published_date: "2026-03-01" }],
      }),
    ]);
    const text = textOf(el);
    expect(text).toContain(formatDate("2026-03-01"));
    const links = findByType<{ href?: string }>(el, "a");
    expect(links.some((a) => a.props.href === "https://a.example")).toBe(true);
  });

  test("доказ без published_date -> посилання є, дата не рендериться поруч", () => {
    const el = build([
      competitor({ id: "c1", name: "X", evidence: [{ url: "https://a.example" }] }),
    ]);
    // Жодних чотиризначних років (форматованих дат) у виводі бути не повинно.
    expect(textOf(el)).not.toMatch(/\d{4}/);
  });

  test("кілька доказів -> усі рендеряться списком", () => {
    const el = build([
      competitor({
        id: "c1",
        name: "X",
        evidence: [{ url: "https://a.example" }, { url: "https://b.example" }],
      }),
    ]);
    const links = findByType<{ href?: string }>(el, "a").map((a) => a.props.href);
    expect(links).toContain("https://a.example");
    expect(links).toContain("https://b.example");
  });
});

describe("CompetitorsSection — довгий текст без згортання", () => {
  test("дуже довгий strengths рендериться повністю, без CollapsibleBody/обрізання", () => {
    const long = "довга сильна сторона ".repeat(200).trim();
    const el = build([competitor({ id: "c1", name: "X", strengths: long })]);
    expect(textOf(el)).toContain(long);
  });
});

describe("CompetitorsSection — Card index/exclude і кілька рядків", () => {
  test("ideaId передається в Card як exclude (сама картка не лінкується на себе)", () => {
    const el = build([competitor({ id: "c1", name: "X" })], "I-self");
    const cards = findByType(el, Card);
    expect(cards).toHaveLength(1);
    expect(cards[0].props).toMatchObject({ exclude: "I-self" });
  });

  test("три конкуренти -> три Card з index 0,1,2 по порядку", () => {
    const el = build([
      competitor({ id: "c1", name: "A" }),
      competitor({ id: "c2", name: "B" }),
      competitor({ id: "c3", name: "C" }),
    ]);
    const cards = findByType<{ index?: number }>(el, Card);
    expect(cards.map((c) => c.props.index)).toEqual([0, 1, 2]);
  });
});
