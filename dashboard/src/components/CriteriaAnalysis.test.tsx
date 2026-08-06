// CriteriaAnalysisSection обгортає кожен критерій і кожну примітку в Card —
// асинхронний серверний компонент (тягне idea-refs.server.ts ->
// "server-only"). ReactDOM (client render) не вміє монтувати компоненти, що
// повертають Promise, тож замість render()+screen викликаємо
// CriteriaAnalysisSection напряму як функцію й обходимо повернене дерево
// React-елементів вручну — той самий підхід, що й у page-idea.test.tsx.
// Card/CollapsibleBody/Prose/VerdictDetails лишаються нев'їханими елементами
// дерева: їхня власна логіка тут не під тестом.
vi.mock("server-only", () => ({}));

import { describe, expect, test, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import CriteriaAnalysisSection from "./CriteriaAnalysis";
import Card from "./Card";
import CollapsibleBody from "./CollapsibleBody";
import Prose from "./Prose";
import VerdictDetails from "./VerdictDetails";
import { MODEL_VOTES_INTRO, TONE_META, type CriterionTone, type CriterionVerdicts } from "@/lib/deep-research";
import type { CriteriaAnalysis } from "@/lib/criteria";
import type { CriteriaVerdictRow } from "@/lib/types";

type ResultItem = CriteriaAnalysis["results"][number];
type NoteItem = CriteriaAnalysis["notes"][number];

function result(overrides: {
  n: number;
  title?: string;
  fatal?: boolean;
  tone: CriterionTone;
  verdict?: string;
  body?: string;
  sharedWith?: number[];
}): ResultItem {
  return {
    spec: { n: overrides.n, title: overrides.title ?? `Критерій ${overrides.n}`, fatal: overrides.fatal ?? true },
    tone: overrides.tone,
    verdict: overrides.verdict ?? "",
    body: overrides.body ?? "",
    sharedWith: overrides.sharedWith,
  } as ResultItem;
}

function note(overrides: Partial<NoteItem> & { title: string; body: string }): NoteItem {
  return { summary: false, ...overrides } as NoteItem;
}

function verdictRow(
  overrides: Partial<CriteriaVerdictRow> & { id: string; criterion_key: string },
): CriteriaVerdictRow {
  return {
    idea_id: "I-1",
    run_id: null,
    stage: "deep",
    kind: "model",
    provider: "openai",
    model: "gpt",
    verdict: "passed",
    score: null,
    summary: null,
    detail: null,
    evidence: null,
    resolution: null,
    criteria_version: null,
    created_at: "2026-01-01T00:00:00Z",
    superseded_at: null,
    ...overrides,
  } as CriteriaVerdictRow;
}

function analysis(results: ResultItem[], notes: NoteItem[] = []): CriteriaAnalysis {
  return { results, notes };
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

function build(a: CriteriaAnalysis, verdicts?: Map<string, CriterionVerdicts>, ideaId?: string) {
  return CriteriaAnalysisSection({ analysis: a, verdicts, ideaId });
}

describe("CriteriaAnalysisSection — вступний рядок про голосування моделей", () => {
  test("verdicts не передано -> вступного рядка немає", () => {
    const el = build(analysis([result({ n: 1, tone: "passed" })]));
    expect(textOf(el)).not.toContain(MODEL_VOTES_INTRO);
  });

  test("verdicts — порожня Map -> вступного рядка немає", () => {
    const el = build(analysis([result({ n: 1, tone: "passed" })]), new Map());
    expect(textOf(el)).not.toContain(MODEL_VOTES_INTRO);
  });

  test("verdicts — Map з хоча б одним записом -> вступний рядок рендериться", () => {
    const verdicts = new Map<string, CriterionVerdicts>([
      ["1", { synthesis: null, models: [verdictRow({ id: "v1", criterion_key: "1" })] }],
    ]);
    const el = build(analysis([result({ n: 1, tone: "passed" })]), verdicts);
    expect(textOf(el)).toContain(MODEL_VOTES_INTRO);
  });
});

describe("CriteriaAnalysisSection — порожній список результатів", () => {
  test("results=[] -> секція рендериться, але список критеріїв порожній", () => {
    const el = build(analysis([]));
    expect(findByType(el, Card)).toHaveLength(0);
  });
});

describe("CriteriaAnalysisSection — фатальність критерія", () => {
  test("fatal=true -> мітка 'нефатальний' не рендериться", () => {
    const el = build(analysis([result({ n: 1, tone: "passed", fatal: true })]));
    expect(textOf(el)).not.toContain("нефатальний");
  });

  test("fatal=false -> мітка 'нефатальний' рендериться з поясненням у title", () => {
    const el = build(analysis([result({ n: 6, tone: "noted", fatal: false })]));
    expect(textOf(el)).toContain("нефатальний");
  });
});

describe("CriteriaAnalysisSection — тон критерія (TONE_META)", () => {
  test.each(Object.keys(TONE_META) as CriterionTone[])("тон '%s' -> лейбл із TONE_META", (tone) => {
    const el = build(analysis([result({ n: 1, tone })]));
    expect(textOf(el)).toContain(TONE_META[tone].label);
  });
});

describe("CriteriaAnalysisSection — verdict (пояснення вердикту)", () => {
  test("verdict — непорожній рядок -> абзац рендериться", () => {
    const el = build(analysis([result({ n: 1, tone: "passed", verdict: "пройдено впевнено" })]));
    expect(textOf(el)).toContain("пройдено впевнено");
  });

  test("verdict — порожній рядок -> абзац не рендериться", () => {
    const el = build(analysis([result({ n: 1, tone: "skipped", verdict: "" })]));
    // Заголовок критерія все одно є, а окремого <p> з вердиктом — нема.
    const card = findByType(el, Card)[0];
    const paragraphs = findByType(card.props.children, "p");
    expect(paragraphs).toHaveLength(0);
  });
});

describe("CriteriaAnalysisSection — body (розгорнутий розбір)", () => {
  test("body непорожній -> CollapsibleBody+Prose рендериться з текстом", () => {
    const el = build(analysis([result({ n: 1, tone: "failed", body: "детальний розбір провалу" })]));
    const collapsible = findByType(el, CollapsibleBody);
    expect(collapsible).toHaveLength(1);
    const prose = findByType<{ content?: string }>(el, Prose);
    expect(prose[0].props.content).toContain("детальний розбір провалу");
  });

  test("body порожній -> CollapsibleBody не рендериться", () => {
    const el = build(analysis([result({ n: 1, tone: "passed", body: "" })]));
    expect(findByType(el, CollapsibleBody)).toHaveLength(0);
  });

  test("body — довгий текст із markdown-розміткою передається в Prose як є", () => {
    const long = "# Заголовок\n\n" + "детальний абзац із **жирним** текстом. ".repeat(80);
    const el = build(analysis([result({ n: 1, tone: "failed", body: long })]));
    const prose = findByType<{ content?: string }>(el, Prose);
    expect(prose[0].props.content).toContain("детальний абзац із");
  });
});

describe("CriteriaAnalysisSection — sharedWith (спільний абзац кількох критеріїв)", () => {
  test("sharedWith задано і body порожній (не перший критерій групи) -> рядок 'Спільний розбір' з номерами", () => {
    const el = build(analysis([result({ n: 4, tone: "skipped", body: "", sharedWith: [3, 4, 5] })]));
    expect(textOf(el)).toContain("Спільний розбір із критеріями 3, 4, 5");
  });

  test("sharedWith задано, але body непорожній (перший критерій групи) -> рядок 'Спільний розбір' НЕ рендериться", () => {
    const el = build(
      analysis([result({ n: 3, tone: "skipped", body: "спільний текст тут", sharedWith: [3, 4, 5] })]),
    );
    expect(textOf(el)).not.toContain("Спільний розбір");
  });

  test("sharedWith не задано -> рядок 'Спільний розбір' не рендериться незалежно від body", () => {
    const el = build(analysis([result({ n: 1, tone: "passed", body: "" })]));
    expect(textOf(el)).not.toContain("Спільний розбір");
  });
});

describe("CriteriaAnalysisSection — VerdictDetails (структуровані вердикти моделей)", () => {
  test("verdicts не передано -> VerdictDetails не рендериться", () => {
    const el = build(analysis([result({ n: 1, tone: "passed" })]));
    expect(findByType(el, VerdictDetails)).toHaveLength(0);
  });

  test("entry є, але synthesis=null і models=[] -> VerdictDetails не рендериться", () => {
    const verdicts = new Map<string, CriterionVerdicts>([["1", { synthesis: null, models: [] }]]);
    const el = build(analysis([result({ n: 1, tone: "passed" })]), verdicts);
    expect(findByType(el, VerdictDetails)).toHaveLength(0);
  });

  test("entry.synthesis задано (models порожній) -> VerdictDetails рендериться", () => {
    const verdicts = new Map<string, CriterionVerdicts>([
      ["1", { synthesis: verdictRow({ id: "s1", criterion_key: "1", kind: "synthesis" }), models: [] }],
    ]);
    const el = build(analysis([result({ n: 1, tone: "passed" })]), verdicts);
    expect(findByType(el, VerdictDetails)).toHaveLength(1);
  });

  test("entry.models непорожній (synthesis=null) -> VerdictDetails рендериться", () => {
    const verdicts = new Map<string, CriterionVerdicts>([
      ["1", { synthesis: null, models: [verdictRow({ id: "m1", criterion_key: "1" })] }],
    ]);
    const el = build(analysis([result({ n: 1, tone: "passed" })]), verdicts);
    expect(findByType(el, VerdictDetails)).toHaveLength(1);
  });

  test("Map не має запису для номера критерія -> VerdictDetails для нього не рендериться", () => {
    const verdicts = new Map<string, CriterionVerdicts>([
      ["99", { synthesis: verdictRow({ id: "s1", criterion_key: "99", kind: "synthesis" }), models: [] }],
    ]);
    const el = build(analysis([result({ n: 1, tone: "passed" })]), verdicts);
    expect(findByType(el, VerdictDetails)).toHaveLength(0);
  });
});

describe("CriteriaAnalysisSection — примітки (analysis.notes)", () => {
  test("notes=[] -> жодної додаткової картки нотаток", () => {
    const el = build(analysis([result({ n: 1, tone: "passed" })]), undefined);
    expect(textOf(el)).not.toContain("Зауваження");
  });

  test("summary=false -> заголовок нотатки без акцентного класу, Card без accent", () => {
    const el = build(analysis([], [note({ title: "Припущення", body: "деякий текст", summary: false })]));
    const cards = findByType<{ accent?: boolean }>(el, Card);
    expect(cards).toHaveLength(1);
    expect(cards[0].props.accent).toBe(false);
    expect(textOf(el)).toContain("Припущення");
  });

  test("summary=true -> Card отримує accent=true (акцентована картка підсумку)", () => {
    const el = build(analysis([], [note({ title: "Підсумок", body: "фінальний висновок", summary: true })]));
    const cards = findByType<{ accent?: boolean }>(el, Card);
    expect(cards).toHaveLength(1);
    expect(cards[0].props.accent).toBe(true);
  });

  test("кілька приміток -> кожна отримує окрему Card з власним index", () => {
    const el = build(
      analysis([], [
        note({ title: "Перша", body: "1", summary: false }),
        note({ title: "Друга", body: "2", summary: true }),
      ]),
    );
    const cards = findByType<{ index?: number }>(el, Card);
    expect(cards.map((c) => c.props.index)).toEqual([0, 1]);
  });
});

describe("CriteriaAnalysisSection — ideaId прокидається в Card як exclude", () => {
  test("ideaId заданий -> усі Card (критерії й примітки) отримують exclude=ideaId", () => {
    const el = build(
      analysis([result({ n: 1, tone: "passed" })], [note({ title: "Т", body: "б", summary: false })]),
      undefined,
      "I-self",
    );
    const cards = findByType<{ exclude?: string }>(el, Card);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.props.exclude).toBe("I-self");
  });
});
