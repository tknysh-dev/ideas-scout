// Тестує src/app/ideas/[id]/page.tsx (IdeaPage) — розбір params.id, notFound(),
// розгалуження за статусом/полями ідеї й умовний рендер секцій глибокого
// дослідження, не сам рендер: викликаємо асинхронну функцію напряму й
// обходимо повернене дерево React-елементів без монтування в DOM (той самий
// підхід, що й у page-home.test.tsx).
//
// Card тягне idea-refs.server.ts -> "server-only"; той модуль тут не під
// тестом, тож маркер нейтралізуємо (як у page-runs.test.tsx). analyzeCriteria/
// splitSection/groupVerdicts/groupByProvider лишаються реальними (вже накриті
// власними .test.mts) — тут перевіряємо саме інтеграцію: які пропси й секції
// сторінка збирає з їхніх результатів.
vi.mock("server-only", () => ({}));

// DecisionPanel/IdeaOptionsMenu тягнуть "use server" дії, які через
// @/auth (next-auth) не резолвяться в тестовому середовищі цього репо (той
// самий фікс, що й у DecisionPanel.test.tsx / IdeaOptionsMenu.test.tsx).
vi.mock("@/lib/actions/decisions", () => ({ decideIdea: vi.fn() }));
vi.mock("@/lib/actions/deep-research", () => ({
  fetchDeepResearchPrompt: vi.fn(),
  commitDeepResearchReports: vi.fn(),
  fetchKnownResearcherModels: vi.fn(),
  previewDeepResearchReports: vi.fn(),
}));

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentType, ReactElement, ReactNode } from "react";

const { getServiceClient } = vi.hoisted(() => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient }));

import IdeaPage from "@/app/ideas/[id]/page";
import Card from "@/components/Card";
import CompetitorsSection from "@/components/CompetitorsSection";
import ConfigNotice from "@/components/ConfigNotice";
import CriteriaAnalysisSection from "@/components/CriteriaAnalysis";
import DecisionPanel from "@/components/DecisionPanel";
import DeepResearchLegend from "@/components/DeepResearchLegend";
import DeepResearchProviderPanel from "@/components/DeepResearchProviderPanel";
import DeepResearchStatus from "@/components/DeepResearchStatus";
import DeepResearchTabs from "@/components/DeepResearchTabs";
import IdeaOptionsMenu from "@/components/IdeaOptionsMenu";
import { Field, FieldGroup } from "@/components/FieldGroup";
import Prose from "@/components/Prose";
import StatusBadge from "@/components/StatusBadge";
import Link from "next/link";
import type {
  CompetitorRow,
  CriteriaVerdictRow,
  EventRow,
  Idea,
  IdeaStatus,
  JobStatus,
  SourceRow,
} from "@/lib/types";

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

function source(overrides: Partial<SourceRow> & { id: number; idea_id: string }): SourceRow {
  return {
    url: "https://example.com",
    origin: null,
    published_date: null,
    author_interest: null,
    independent_confirmations: 0,
    quote: null,
    ...overrides,
  };
}

function event(overrides: Partial<EventRow> & { id: number; idea_id: string }): EventRow {
  return {
    happened_at: "2026-01-02T00:00:00Z",
    run_id: null,
    actor: "analyst",
    change: "статус змінено",
    reason: null,
    ...overrides,
  };
}

function verdict(
  overrides: Partial<CriteriaVerdictRow> & { id: string; idea_id: string; criterion_key: string },
): CriteriaVerdictRow {
  return {
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

function competitor(
  overrides: Partial<CompetitorRow> & { id: string; idea_id: string; name: string },
): CompetitorRow {
  return {
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
  } as CompetitorRow;
}

function job(overrides: {
  status: JobStatus;
  created_at?: string;
  run_id?: string | null;
  last_error?: string | null;
}) {
  return {
    created_at: "2026-01-01T00:00:00Z",
    run_id: null,
    last_error: null,
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

function ideaQuery(result: {
  data: Idea | null | { id: string; title: string };
  error?: { message: string } | null;
}) {
  return { select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) };
}
function listQuery(result: { data: unknown[] | null }) {
  return { select: () => ({ eq: () => ({ order: async () => result }) }) };
}
function verdictsQuery(result: { data: unknown[] | null }) {
  return { select: () => ({ eq: () => ({ eq: () => ({ is: async () => result }) }) }) };
}
function competitorsQuery(result: { data: unknown[] | null }) {
  return { select: () => ({ eq: () => ({ is: () => ({ order: async () => result }) }) }) };
}
function jobsQuery(result: { data: unknown[] | null }) {
  return {
    select: () => ({
      eq: () => ({ filter: () => ({ order: () => ({ limit: async () => result }) }) }),
    }),
  };
}

function mockSupabase({
  idea: ideaRow,
  ideaError = null,
  sources = [],
  events = [],
  verdictRows = [],
  competitorRows = [],
  lastJobs = [],
  parent = null,
}: {
  idea: Idea | null;
  ideaError?: { message: string } | null;
  sources?: SourceRow[];
  events?: EventRow[];
  verdictRows?: CriteriaVerdictRow[];
  competitorRows?: CompetitorRow[];
  lastJobs?: ReturnType<typeof job>[];
  parent?: { id: string; title: string } | null;
}) {
  const from = vi.fn();
  from.mockReturnValueOnce(ideaQuery({ data: ideaRow, error: ideaError }));
  from.mockReturnValueOnce(listQuery({ data: sources }));
  from.mockReturnValueOnce(listQuery({ data: events }));
  from.mockReturnValueOnce(verdictsQuery({ data: verdictRows }));
  from.mockReturnValueOnce(competitorsQuery({ data: competitorRows }));
  from.mockReturnValueOnce(jobsQuery({ data: lastJobs }));
  if (ideaRow?.parent_id) {
    from.mockReturnValueOnce(ideaQuery({ data: parent }));
  }
  return { from };
}

function call(id: string) {
  return IdeaPage({ params: Promise.resolve({ id }) });
}

beforeEach(() => {
  getServiceClient.mockReset();
});

test("немає доступу до бази -> ConfigNotice", async () => {
  getServiceClient.mockReturnValue(null);
  const el = await call("I-1");
  expect(findByType(el, ConfigNotice)).toHaveLength(1);
});

describe("notFound()", () => {
  test("ідеї з таким id немає (data: null) -> кидає NEXT_HTTP_ERROR_FALLBACK;404", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: null }));
    await expect(call("ZZZ")).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  // Сторінка тепер розрізняє "запит до ideas упав" (error задано) від "ідеї
  // справді немає" (data: null, error: null) — перше кидає помилку (і її
  // підхопить error boundary), а не показує той самий 404, що й видалена картка.
  test("помилка запиту ideas (data: null, error задано) -> кидає помилку, а не notFound()/ConfigNotice", async () => {
    const supabase = mockSupabase({
      idea: null,
      ideaError: { message: "з'єднання з базою розірвано" },
    });
    getServiceClient.mockReturnValue(supabase);
    await expect(call("I-1")).rejects.toThrow("з'єднання з базою розірвано");
  });

  test("id передається в запит ideas як є", async () => {
    const supabase = mockSupabase({ idea: idea({ id: "I-42" }) });
    getServiceClient.mockReturnValue(supabase);
    await call("I-42");
    expect(supabase.from).toHaveBeenNthCalledWith(1, "ideas");
  });
});

test("мінімальна ідея з усіма nullable-полями null -> рендериться без падіння, порожні поля як '—'", async () => {
  getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }) }));
  const el = await call("I-1");
  const groups = findByType(el, FieldGroup);
  expect(groups.length).toBeGreaterThan(0);
  const allText = groups.map((g) => textOf(g.props.children)).join(" | ");
  // claimed_revenue, ceiling_estimate, launch_effort_hours, review_condition,
  // verdict_provider/model/run_id, criteria_version — усі null у фікстурі.
  expect(allText.split("—").length - 1).toBeGreaterThanOrEqual(6);
  expect(findByType(el, ConfigNotice)).toHaveLength(0);
});

describe("поодинокі truthy-гілки на протилежність null-фікстурі", () => {
  test("mechanic_summary задано -> абзац під заголовком рендериться", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", mechanic_summary: "короткий опис механіки" }) }),
    );
    const el = await call("I-1");
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).toContain("короткий опис механіки");
  });

  test("monetization_hypothesis задано -> Field 'Гіпотеза монетизації' рендериться", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", monetization_hypothesis: "підписка €5/міс" }) }),
    );
    const el = await call("I-1");
    const field = findByType(el, Field).find((f) => f.props.label === "Гіпотеза монетизації");
    expect(field).toBeDefined();
    expect(textOf(field!.props.children)).toContain("підписка €5/міс");
  });

  test("ceiling_flag='review' -> Field 'Позначка' показує 'Винесено на ручну оцінку'", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", ceiling_flag: "review" }) }),
    );
    const el = await call("I-1");
    const field = findByType(el, Field).find((f) => f.props.label === "Позначка");
    expect(textOf(field!.props.children)).toContain("Винесено на ручну оцінку");
  });

  test("research_depth='deep' і є вердикти моделей -> Field 'Глибина дослідження' перелічує провайдерів", async () => {
    const rows = [
      verdict({ id: "v1", idea_id: "I-1", criterion_key: "1", kind: "model", provider: "openai" }),
    ];
    getServiceClient.mockReturnValue(
      mockSupabase({
        idea: idea({ id: "I-1", research_depth: "deep" }),
        verdictRows: rows,
      }),
    );
    const el = await call("I-1");
    const field = findByType(el, Field).find((f) => f.props.label === "Глибина дослідження");
    expect(textOf(field!.props.children)).toContain("openai");
  });

  test("подія з reason -> абзац із причиною рендериться поруч зі зміною", async () => {
    const rows = [
      event({ id: 1, idea_id: "I-1", change: "статус -> відхилено", reason: "не пройшов критерій 2" }),
    ];
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), events: rows }));
    const el = await call("I-1");
    expect(textOf(el)).toContain("не пройшов критерій 2");
  });

  test("verdictRows і competitorRows приходять як null (не масив) -> '?? []' підхоплює фолбек, сторінка не падає", async () => {
    const supabase = mockSupabase({ idea: idea({ id: "I-1" }) });
    // Замінюємо результати 4-го (criteria_verdicts) і 5-го (competitors)
    // виклику .from() на data: null — так само, як миттєвий збій supabase
    // повернув би на цих двох запитах, поки ideas усе ще знайдено.
    supabase.from.mockReset();
    supabase.from
      .mockReturnValueOnce(ideaQuery({ data: idea({ id: "I-1" }) }))
      .mockReturnValueOnce(listQuery({ data: [] }))
      .mockReturnValueOnce(listQuery({ data: [] }))
      .mockReturnValueOnce(verdictsQuery({ data: null }))
      .mockReturnValueOnce(competitorsQuery({ data: null }))
      .mockReturnValueOnce(jobsQuery({ data: [] }));
    getServiceClient.mockReturnValue(supabase);
    const el = await call("I-1");
    expect(findByType(el, CompetitorsSection)).toHaveLength(0);
    expect(findByType(el, ConfigNotice)).toHaveLength(0);
  });
});

describe("розгалуження OWNER_DECIDABLE_STATUSES", () => {
  const decidable: IdeaStatus[] = ["approved_pending", "accepted", "rejected"];
  const notDecidable: IdeaStatus[] = ["new", "analyzing", "transferred"];

  test.each(decidable)("статус '%s' -> DecisionPanel(bare) і IdeaOptionsMenu показані", async (status) => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1", status }) }));
    const el = await call("I-1");
    expect(findByType(el, DecisionPanel)).toHaveLength(1);
    expect(findByType(el, IdeaOptionsMenu)).toHaveLength(1);
  });

  test.each(notDecidable)("статус '%s' -> DecisionPanel і IdeaOptionsMenu приховані", async (status) => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1", status }) }));
    const el = await call("I-1");
    expect(findByType(el, DecisionPanel)).toHaveLength(0);
    expect(findByType(el, IdeaOptionsMenu)).toHaveLength(0);
  });

  test("StatusBadge завжди показує статус ідеї, незалежно від рішучості", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1", status: "new" }) }));
    const el = await call("I-1");
    expect(findByType(el, StatusBadge)[0].props.status).toBe("new");
  });
});

describe("хлібна крихта / parent_id", () => {
  test("parent_id відсутній -> лише один запит до 'ideas' (без запиту батька)", async () => {
    const supabase = mockSupabase({ idea: idea({ id: "I-1", parent_id: null }) });
    getServiceClient.mockReturnValue(supabase);
    await call("I-1");
    expect(supabase.from).toHaveBeenCalledTimes(6);
  });

  test("parent_id присутній -> додатковий запит до 'ideas' за parent_id, посилання з назвою батька", async () => {
    const supabase = mockSupabase({
      idea: idea({ id: "I-1", parent_id: "I-0" }),
      parent: { id: "I-0", title: "Батьківська механіка" },
    });
    getServiceClient.mockReturnValue(supabase);
    const el = await call("I-1");
    expect(supabase.from).toHaveBeenCalledTimes(7);
    const links = findByType(el, Link);
    const parentLink = links.find((l) => l.props.href === "/ideas/I-0");
    expect(parentLink).toBeDefined();
    expect(textOf(parentLink!.props.children)).toBe("Батьківська механіка");
  });

  test("parent_id присутній, але батька вже видалено (maybeSingle -> null) -> без посилання, сторінка не падає", async () => {
    const supabase = mockSupabase({
      idea: idea({ id: "I-1", parent_id: "I-0" }),
      parent: null,
    });
    getServiceClient.mockReturnValue(supabase);
    const el = await call("I-1");
    const links = findByType(el, Link);
    expect(links.some((l) => l.props.href === "/ideas/I-0")).toBe(false);
  });
});

describe("глибина дослідження і плашка", () => {
  test("research_depth='deep' -> плашка 'Глибоке дослідження' у шапці", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", research_depth: "deep" }) }),
    );
    const el = await call("I-1");
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).toContain("Глибоке дослідження");
  });

  test("research_depth='initial' -> плашки немає", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", research_depth: "initial" }) }),
    );
    const el = await call("I-1");
    const card = findByType(el, Card)[0];
    expect(textOf(card.props.children)).not.toContain("Глибоке дослідження");
  });
});

describe("activeJob — блок стану синтезу", () => {
  test("немає jobs -> DeepResearchStatus не рендериться", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), lastJobs: [] }));
    const el = await call("I-1");
    expect(findByType(el, DeepResearchStatus)).toHaveLength(0);
  });

  test("останній job succeeded -> DeepResearchStatus не рендериться (картка вже показує підсумок)", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1" }), lastJobs: [job({ status: "succeeded" })] }),
    );
    const el = await call("I-1");
    expect(findByType(el, DeepResearchStatus)).toHaveLength(0);
  });

  test("останній job running -> DeepResearchStatus рендериться з його даними", async () => {
    const runningJob = job({ status: "running", run_id: "R-1" });
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1" }), lastJobs: [runningJob] }),
    );
    const el = await call("I-1");
    const status = findByType(el, DeepResearchStatus);
    expect(status).toHaveLength(1);
    expect(status[0].props.job).toMatchObject({ status: "running", run_id: "R-1" });
  });
});

describe("глибокі вердикти — легенда, критерії, панелі за моделями", () => {
  test("verdictRows порожні -> легенди немає, CriteriaAnalysisSection отримує verdicts=undefined", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), verdictRows: [] }));
    const el = await call("I-1");
    expect(findByType(el, DeepResearchLegend)).toHaveLength(0);
    const section = findByType(el, CriteriaAnalysisSection);
    expect(section).toHaveLength(1);
    expect(section[0].props.verdicts).toBeUndefined();
  });

  test("verdictRows заповнені -> легенда рендериться, CriteriaAnalysisSection отримує Map вердиктів", async () => {
    const rows = [
      verdict({ id: "v1", idea_id: "I-1", criterion_key: "1", kind: "model", provider: "openai" }),
    ];
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), verdictRows: rows }));
    const el = await call("I-1");
    expect(findByType(el, DeepResearchLegend)).toHaveLength(1);
    const section = findByType(el, CriteriaAnalysisSection);
    expect(section[0].props.verdicts).toBeInstanceOf(Map);
    expect(section[0].props.verdicts!.has("1")).toBe(true);
  });

  test("трек поза CHECKLISTS (invalid) -> analyzeCriteria повертає null -> CriteriaAnalysisSection не рендериться", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", track: "невідомий-трек" }) }),
    );
    const el = await call("I-1");
    expect(findByType(el, CriteriaAnalysisSection)).toHaveLength(0);
  });

  test("моделі однієї групи -> DeepResearchTabs з рівно однією вкладкою; провайдера без kind='model' у групах немає", async () => {
    const rows = [
      verdict({ id: "v1", idea_id: "I-1", criterion_key: "1", kind: "model", provider: "openai" }),
      verdict({ id: "v2", idea_id: "I-1", criterion_key: "2", kind: "model", provider: "openai" }),
      verdict({ id: "v3", idea_id: "I-1", criterion_key: "1", kind: "synthesis", provider: "synthesis" }),
    ];
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), verdictRows: rows }));
    const el = await call("I-1");
    const tabs = findByType(el, DeepResearchTabs);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].props.tabs).toHaveLength(1);
    expect(tabs[0].props.tabs[0].provider).toBe("openai");
    // panel — не children, а окреме поле об'єкта в масиві tabs[], тому шукаємо
    // його вручну замість findByType (та обходить лише .props.children).
    const panel = tabs[0].props.tabs[0].panel as ReactElement<{ group: unknown; ideaId?: string }>;
    expect(panel.type).toBe(DeepResearchProviderPanel);
  });

  test("без рядків kind='model' -> providerGroups порожній, DeepResearchTabs не рендериться", async () => {
    const rows = [
      verdict({ id: "v3", idea_id: "I-1", criterion_key: "1", kind: "synthesis", provider: "synthesis" }),
    ];
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), verdictRows: rows }));
    const el = await call("I-1");
    expect(findByType(el, DeepResearchTabs)).toHaveLength(0);
  });
});

describe("конкуренти", () => {
  test("competitorRows порожні -> CompetitorsSection не рендериться", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), competitorRows: [] }));
    const el = await call("I-1");
    expect(findByType(el, CompetitorsSection)).toHaveLength(0);
  });

  test("competitorRows заповнені -> CompetitorsSection рендериться з ними", async () => {
    const rows = [competitor({ id: "c1", idea_id: "I-1", name: "Конкурент А" })];
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1" }), competitorRows: rows }),
    );
    const el = await call("I-1");
    const section = findByType(el, CompetitorsSection);
    expect(section).toHaveLength(1);
    expect(section[0].props.competitors).toEqual(rows);
  });

  test("конкуренти є -> секцію 'Конкуренти' з тіла-прози вирізано (не дублюється в Prose)", async () => {
    const body = "Опис ідеї.\n\n## Конкуренти\n\nПрозовий список конкурентів.\n\n## Інше\n\nхвіст";
    const rows = [competitor({ id: "c1", idea_id: "I-1", name: "X" })];
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", body }), competitorRows: rows }),
    );
    const el = await call("I-1");
    const prose = findByType(el, Prose);
    expect(prose[0].props.content).not.toContain("Прозовий список конкурентів");
    expect(prose[0].props.content).toContain("хвіст");
  });

  // Сумнівна поведінка: вирізання секції "Конкуренти" з прози тіла спрацьовує
  // лише коли competitors.length > 0. Якщо структуровані рядки ще не
  // з'явились (наприклад, синтез конкурентів ще не запускали), а аналітик уже
  // написав прозовий розділ "## Конкуренти" в тілі — він лишається як є, без
  // структурованої секції над ним.
  test("той самий розділ '## Конкуренти' у прозі, але competitorRows порожні -> розділ НЕ вирізається (лишається в Prose)", async () => {
    const body = "Опис ідеї.\n\n## Конкуренти\n\nПрозовий список конкурентів.";
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", body }), competitorRows: [] }),
    );
    const el = await call("I-1");
    const prose = findByType(el, Prose);
    expect(prose[0].props.content).toContain("Прозовий список конкурентів");
  });
});

describe("опис (bodyRest / Prose)", () => {
  test("body === null -> секція 'Опис' не рендериться", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1", body: null }) }));
    const el = await call("I-1");
    expect(findByType(el, Prose)).toHaveLength(0);
  });

  test("body заповнене -> секція 'Опис' рендериться через Prose", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", body: "Просто опис без секцій." }) }),
    );
    const el = await call("I-1");
    const prose = findByType(el, Prose);
    expect(prose).toHaveLength(1);
    expect(prose[0].props.content).toContain("Просто опис");
  });
});

describe("джерела", () => {
  test("sources порожні -> секція 'Джерела' не рендериться", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), sources: [] }));
    const el = await call("I-1");
    const el2 = findByType(el, "h2").find((h) => textOf(h.props.children).includes("Джерела"));
    expect(el2).toBeUndefined();
  });

  test("sources заповнені -> секція 'Джерела' рендериться, quote/author_interest/origin показані, коли задані", async () => {
    const rows = [
      source({
        id: 1,
        idea_id: "I-1",
        url: "https://a.example",
        quote: "цитата з джерела",
        author_interest: "affiliate",
        origin: "reddit",
      }),
    ];
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), sources: rows }));
    const el = await call("I-1");
    const heading = findByType(el, "h2").find((h) => textOf(h.props.children).includes("Джерела"));
    expect(heading).toBeDefined();
    const links = findByType<{ href?: string; children?: ReactNode }>(el, "a");
    const src = links.find((a) => a.props.href === "https://a.example");
    expect(src).toBeDefined();
  });
});

describe("хронологія подій", () => {
  test("events порожні -> секція 'Хронологія подій' не рендериться", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), events: [] }));
    const el = await call("I-1");
    const heading = findByType(el, "h2").find((h) =>
      textOf(h.props.children).includes("Хронологія подій"),
    );
    expect(heading).toBeUndefined();
  });

  test("events заповнені, reason відсутній -> запис без рядка причини", async () => {
    const rows = [event({ id: 1, idea_id: "I-1", change: "статус -> прийнято", reason: null })];
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1" }), events: rows }));
    const el = await call("I-1");
    const heading = findByType(el, "h2").find((h) =>
      textOf(h.props.children).includes("Хронологія подій"),
    );
    expect(heading).toBeDefined();
  });
});

describe("поля вердикту й перегляду — nullable за замовчуванням", () => {
  test("rejection_code/detail/codes_extra відсутні -> відповідні поля не рендеряться", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({
        idea: idea({ id: "I-1", rejection_code: null, rejection_detail: null, rejection_codes_extra: [] }),
      }),
    );
    const el = await call("I-1");
    const groups = findByType(el, FieldGroup);
    const text = groups.map((g) => textOf(g.props.children)).join(" | ");
    expect(text).not.toContain("Код відмови");
    expect(text).not.toContain("Деталі відмови");
    expect(text).not.toContain("Супутні коди");
  });

  test("rejection_code задано -> показує людський лейбл із REJECTION_META; rejection_codes_extra з невідомим кодом лишає код як є", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({
        idea: idea({
          id: "I-1",
          rejection_code: "NO_MARKET",
          rejection_detail: "деталі відмови",
          rejection_codes_extra: ["LEGAL", "НЕВІДОМИЙ_КОД"],
        }),
      }),
    );
    const el = await call("I-1");
    const groups = findByType(el, FieldGroup);
    const text = groups.map((g) => textOf(g.props.children)).join(" | ");
    expect(text).toContain("Немає ознак ринку/попиту");
    expect(text).toContain("деталі відмови");
    expect(text).toContain("Юридична заборона");
    expect(text).toContain("НЕВІДОМИЙ_КОД");
  });

  test("missing_capabilities непорожній -> Field зі списком через кому", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", missing_capabilities: ["playwright", "sms-api"] }) }),
    );
    const el = await call("I-1");
    const groups = findByType(el, FieldGroup);
    const text = groups.map((g) => textOf(g.props.children)).join(" | ");
    expect(text).toContain("playwright, sms-api");
  });

  test("transferred_to задано -> посилання на нову картку; не задано -> '—'", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", transferred_to: "I-99" }) }),
    );
    const el = await call("I-1");
    const links = findByType(el, Link);
    expect(links.some((l) => l.props.href === "/ideas/I-99")).toBe(true);
  });

  test("confidence задано -> людський лейбл із CONFIDENCE_META", async () => {
    getServiceClient.mockReturnValue(mockSupabase({ idea: idea({ id: "I-1", confidence: "high" }) }));
    const el = await call("I-1");
    const groups = findByType(el, FieldGroup);
    const text = groups.map((g) => textOf(g.props.children)).join(" | ");
    expect(text).toContain("Висока");
  });

  test("verdict_run_id задано -> посилання на /runs; не задано -> без посилання", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", verdict_run_id: "R-7" }) }),
    );
    const el = await call("I-1");
    const links = findByType(el, Link);
    const runLink = links.find((l) => l.props.href === "/runs");
    expect(runLink).toBeDefined();
    expect(textOf(runLink!.props.children)).toBe("R-7");
  });

  test("deep_researched_at задано -> окремий Field з датою; не задано -> Field відсутній", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", deep_researched_at: "2026-02-01T00:00:00Z" }) }),
    );
    const el = await call("I-1");
    const field = findByType(el, Field).find((f) => f.props.label === "Глибоке дослідження");
    expect(field).toBeDefined();
    expect(textOf(field!.props.children)).toContain("2026");
  });

  test("deep_researched_at не задано (null) -> Field 'Глибоке дослідження' (у групі провенансу) відсутній", async () => {
    getServiceClient.mockReturnValue(
      mockSupabase({ idea: idea({ id: "I-1", deep_researched_at: null }) }),
    );
    const el = await call("I-1");
    const field = findByType(el, Field).find((f) => f.props.label === "Глибоке дослідження");
    expect(field).toBeUndefined();
  });
});
