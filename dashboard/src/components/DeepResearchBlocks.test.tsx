// DeepResearchBlocks рендерить <Card as="li" ...> для кожного блоку, а Card —
// асинхронний серверний компонент (тягне idea-refs.server.ts -> "server-only").
// Клієнтський react-dom (яким рендерить RTL) не вміє змонтувати вкладений
// async-компонент, тож підміняємо Card на синхронний стаб: розбір id ідей і
// сам Card тестує Card.test.tsx, тут під тестом лише логіка DeepResearchBlocks
// (фільтрація блоків, вибір тону, умовний рендер синтезу).
import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/components/Card", () => ({
  default: ({ children, exclude }: { children: React.ReactNode; exclude?: string }) => (
    <li data-exclude={exclude ?? ""}>{children}</li>
  ),
}));

import DeepResearchBlocks from "@/components/DeepResearchBlocks";
import { DEEP_BLOCKS, type CriterionVerdicts, type DeepResearchData } from "@/lib/deep-research";
import type { CriteriaVerdictRow, CriterionVerdict } from "@/lib/types";

function row(overrides: Partial<CriteriaVerdictRow> & { criterion_key: string }): CriteriaVerdictRow {
  return {
    id: "row-1",
    idea_id: "PI-0001",
    run_id: null,
    stage: "deep",
    kind: "synthesis",
    provider: "openai",
    model: null,
    verdict: "passed",
    score: null,
    summary: null,
    detail: null,
    evidence: null,
    resolution: null,
    criteria_version: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// byKey будуємо руками (не через groupVerdicts): реальний групувальник ніколи
// не створює запис із synthesis=null і models=[] одночасно, а ми хочемо
// перевірити саме цю (захисну, інакше недосяжну) гілку фільтра блоків.
function makeData(entries: Record<string, CriterionVerdicts>): DeepResearchData {
  return { byKey: new Map(Object.entries(entries)), providers: [], hasDisagreement: false };
}

const KEY_A = DEEP_BLOCKS[0].key; // d_demand
const KEY_B = DEEP_BLOCKS[1].key; // d_unit_econ

describe("DeepResearchBlocks — блоків немає (blocks.length === 0)", () => {
  test("порожній byKey — компонент нічого не рендерить", () => {
    const { container } = render(<DeepResearchBlocks data={makeData({})} />);
    expect(container.firstChild).toBeNull();
  });

  test("byKey має запис, але synthesis=null і models=[] — блок відфільтровується, рендер порожній", () => {
    const data = makeData({ [KEY_A]: { synthesis: null, models: [] } });
    const { container } = render(<DeepResearchBlocks data={data} />);
    expect(container.firstChild).toBeNull();
  });

  test("byKey має ключ поза DEEP_BLOCKS — ігнорується, рендер порожній", () => {
    const data = makeData({
      "9": { synthesis: row({ criterion_key: "9" }), models: [] },
    });
    const { container } = render(<DeepResearchBlocks data={data} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("DeepResearchBlocks — один блок, лише моделі (без синтезу)", () => {
  test("synthesis=null, models.length > 0 — блок включається, плашка «лише моделі»", () => {
    const data = makeData({
      [KEY_A]: { synthesis: null, models: [row({ criterion_key: KEY_A, kind: "model" })] },
    });
    render(<DeepResearchBlocks data={data} />);
    expect(screen.getByText(DEEP_BLOCKS[0].title)).toBeDefined();
    expect(screen.getByText("лише моделі")).toBeDefined();
  });
});

describe("DeepResearchBlocks — один блок із синтезом", () => {
  test("synthesis заданий, verdict відомий (passed) — плашка «Пройдено», без «лише моделі»", () => {
    const data = makeData({
      [KEY_A]: { synthesis: row({ criterion_key: KEY_A, verdict: "passed" }), models: [] },
    });
    render(<DeepResearchBlocks data={data} />);
    expect(screen.getByText("Пройдено")).toBeDefined();
    expect(screen.queryByText("лише моделі")).toBeNull();
  });

  test("synthesis.summary заданий — рендериться абзац із summary", () => {
    const data = makeData({
      [KEY_A]: {
        synthesis: row({ criterion_key: KEY_A, verdict: "failed", summary: "Короткий підсумок критерію" }),
        models: [],
      },
    });
    render(<DeepResearchBlocks data={data} />);
    expect(screen.getByText("Короткий підсумок критерію")).toBeDefined();
  });

  test("synthesis.summary відсутній (null) — абзацу з summary немає", () => {
    const data = makeData({
      [KEY_A]: { synthesis: row({ criterion_key: KEY_A, verdict: "failed", summary: null }), models: [] },
    });
    const { container } = render(<DeepResearchBlocks data={data} />);
    // Секція має свій вступний <p> завжди — перевіряємо саме картку блоку
    // (стаб <li>), а не всю секцію: у ній не повинно бути жодного <p>.
    const item = container.querySelector("li[data-exclude]") as HTMLElement;
    expect(item.querySelectorAll("p")).toHaveLength(0);
  });

  test("невідоме значення verdict (поза словником CriterionVerdict) — показує сирий вердикт замість «лише моделі» (verdictMeta мирує фолбек)", () => {
    const data = makeData({
      [KEY_A]: {
        synthesis: row({ criterion_key: KEY_A, verdict: "unexpected_verdict" as CriterionVerdict }),
        models: [],
      },
    });
    expect(() => render(<DeepResearchBlocks data={data} />)).not.toThrow();
    expect(screen.queryByText("лише моделі")).toBeNull();
    expect(screen.getByText("unexpected_verdict")).toBeDefined();
  });
});

describe("DeepResearchBlocks — кілька блоків і exclude", () => {
  test("два включені блоки рендеряться в порядку DEEP_BLOCKS, exclude прокидається в Card", () => {
    const data = makeData({
      [KEY_B]: { synthesis: row({ criterion_key: KEY_B, verdict: "owner" }), models: [] },
      [KEY_A]: { synthesis: row({ criterion_key: KEY_A, verdict: "passed" }), models: [] },
    });
    const { container } = render(<DeepResearchBlocks data={data} ideaId="PI-0099" />);
    const items = container.querySelectorAll("li[data-exclude]");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(DEEP_BLOCKS[0].title);
    expect(items[1].textContent).toContain(DEEP_BLOCKS[1].title);
    expect(items[0].getAttribute("data-exclude")).toBe("PI-0099");
  });

  test("ideaId не переданий — Card отримує exclude=undefined (порожній рядок у стабі)", () => {
    const data = makeData({
      [KEY_A]: { synthesis: row({ criterion_key: KEY_A, verdict: "passed" }), models: [] },
    });
    const { container } = render(<DeepResearchBlocks data={data} />);
    const item = container.querySelector("li[data-exclude]");
    expect(item?.getAttribute("data-exclude")).toBe("");
  });
});

describe("DeepResearchBlocks — заголовок і опис секції завжди присутні, коли є хоч один блок", () => {
  test("допоміжний вступний текст секції рендериться разом із блоками", () => {
    const data = makeData({
      [KEY_A]: { synthesis: row({ criterion_key: KEY_A, verdict: "passed" }), models: [] },
    });
    render(<DeepResearchBlocks data={data} />);
    const heading = screen.getByRole("heading", { name: /Глибоке дослідження/ });
    expect(within(heading.closest("section") as HTMLElement).getByText(DEEP_BLOCKS[0].title)).toBeDefined();
  });
});
