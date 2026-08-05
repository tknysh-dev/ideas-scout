// deep-research-prompt.server.ts лежить у src/lib/, але цей файл живе тут:
// vitest.config.mts підхоплює лише src/components/**/*.test.tsx
// (src/lib/*.test.mts зарезервовано за node --test, який не вміє vi.mock) —
// інакше файл просто не запускався б через `npm test`. Мокаємо "server-only",
// диск (readConfigFile), Supabase (getServiceClient) і саму renderHandoffPrompt
// (вона вже накрита окремо в deep-research-prompt.test.mts) — тут перевіряємо
// лише оркестрацію: що buildDeepResearchPrompt() повертає за кожного стану
// вхідних даних.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readConfigFile } = vi.hoisted(() => ({ readConfigFile: vi.fn() }));
vi.mock("@/lib/config-files", () => ({ readConfigFile }));

const { getServiceClient } = vi.hoisted(() => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient }));

const { renderHandoffPrompt } = vi.hoisted(() => ({ renderHandoffPrompt: vi.fn() }));
vi.mock("@/lib/deep-research-prompt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deep-research-prompt")>();
  return { ...actual, renderHandoffPrompt };
});

import { buildDeepResearchPrompt } from "@/lib/deep-research-prompt.server";

const BASE_IDEA = {
  id: "PI-0001",
  title: "Ідея",
  type: "mechanic",
  track: "passive-income",
  status: "approved_pending",
  signal_type: "income_claim",
  claimed_revenue: null,
  mechanic_summary: "коротко",
  monetization_hypothesis: null,
  body: "текст",
};

function makeSupabase({
  ideaResult,
  sourcesResult = { data: [], error: null },
}: {
  ideaResult: { data: unknown; error: { message: string } | null };
  sourcesResult?: { data: unknown; error: { message: string } | null };
}) {
  const from = vi.fn((table: string) => {
    if (table === "ideas") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ideaResult }) }) };
    }
    if (table === "sources") {
      return {
        select: () => ({
          eq: () => ({ order: () => ({ returns: async () => sourcesResult }) }),
        }),
      };
    }
    throw new Error(`неочікувана таблиця: ${table}`);
  });
  return { from };
}

beforeEach(() => {
  readConfigFile.mockReset();
  getServiceClient.mockReset();
  renderHandoffPrompt.mockReset();
});

test("немає доступу до бази (getServiceClient() === null) -> помилка, без запитів", async () => {
  getServiceClient.mockReturnValue(null);
  await expect(buildDeepResearchPrompt("PI-0001")).resolves.toEqual({
    error: "Немає доступу до бази.",
  });
});

test("Supabase повернув помилку по ідеї -> помилка з текстом Supabase", async () => {
  getServiceClient.mockReturnValue(
    makeSupabase({ ideaResult: { data: null, error: { message: "зв'язок розірвано" } } }),
  );
  await expect(buildDeepResearchPrompt("PI-0001")).resolves.toEqual({
    error: "Не вдалося прочитати ідею: зв'язок розірвано",
  });
});

test("ідею не знайдено (data: null, без помилки) -> 'Ідею не знайдено.'", async () => {
  getServiceClient.mockReturnValue(makeSupabase({ ideaResult: { data: null, error: null } }));
  await expect(buildDeepResearchPrompt("PI-9999")).resolves.toEqual({ error: "Ідею не знайдено." });
});

test("статус ідеї не входить в OWNER_DECIDABLE_STATUSES ('new') -> зарано для дослідження", async () => {
  getServiceClient.mockReturnValue(
    makeSupabase({ ideaResult: { data: { ...BASE_IDEA, status: "new" }, error: null } }),
  );
  await expect(buildDeepResearchPrompt("PI-0001")).resolves.toEqual({
    error: "Глибоке дослідження доступне після первинної оцінки ідеї.",
  });
});

test("трек без чек-листа критеріїв -> помилка з назвою треку", async () => {
  getServiceClient.mockReturnValue(
    makeSupabase({ ideaResult: { data: { ...BASE_IDEA, track: "unknown-track" }, error: null } }),
  );
  await expect(buildDeepResearchPrompt("PI-0001")).resolves.toEqual({
    error: "Трек «unknown-track» не має чек-листа критеріїв.",
  });
});

test("Supabase повернув помилку по джерелах -> помилка з текстом Supabase", async () => {
  getServiceClient.mockReturnValue(
    makeSupabase({
      ideaResult: { data: BASE_IDEA, error: null },
      sourcesResult: { data: null, error: { message: "timeout" } },
    }),
  );
  await expect(buildDeepResearchPrompt("PI-0001")).resolves.toEqual({
    error: "Не вдалося прочитати джерела: timeout",
  });
});

test("readConfigFile кидає (шаблон відсутній) -> помилка з текстом винятку", async () => {
  getServiceClient.mockReturnValue(makeSupabase({ ideaResult: { data: BASE_IDEA, error: null } }));
  readConfigFile.mockRejectedValue(new Error("GITHUB_TOKEN не налаштовано"));
  await expect(buildDeepResearchPrompt("PI-0001")).resolves.toEqual({
    error: "Не вдалося прочитати шаблон промпта: GITHUB_TOKEN не налаштовано",
  });
});

test("readConfigFile кидає не-Error значення -> String(err) у повідомленні", async () => {
  getServiceClient.mockReturnValue(makeSupabase({ ideaResult: { data: BASE_IDEA, error: null } }));
  readConfigFile.mockRejectedValue("плоский рядок помилки");
  await expect(buildDeepResearchPrompt("PI-0001")).resolves.toEqual({
    error: "Не вдалося прочитати шаблон промпта: плоский рядок помилки",
  });
});

describe("щасливий шлях", () => {
  test("збирає prompt із трьох файлів конфігурації і джерел ідеї", async () => {
    getServiceClient.mockReturnValue(
      makeSupabase({
        ideaResult: { data: BASE_IDEA, error: null },
        sourcesResult: {
          data: [{ url: "https://example.com", published_date: null, author_interest: null }],
          error: null,
        },
      }),
    );
    readConfigFile.mockImplementation(async (path: string) => ({
      content: `вміст:${path}`,
      changed: null,
    }));
    renderHandoffPrompt.mockReturnValue("готовий промпт");

    const result = await buildDeepResearchPrompt("PI-0001", "2026-08-05");
    expect(result).toEqual({ prompt: "готовий промпт" });

    expect(renderHandoffPrompt).toHaveBeenCalledWith({
      idea: BASE_IDEA,
      sources: [{ url: "https://example.com", published_date: null, author_interest: null }],
      template: "вміст:agents/prompts/deep-research-handoff.md",
      criteriaDoc: "вміст:agents/criteria/external/brief-passive-income.md",
      deepDoc: "вміст:agents/criteria/external/brief-deep-blocks.md",
      today: "2026-08-05",
    });
  });

  test("sources: null -> у renderHandoffPrompt передається порожній масив, не null", async () => {
    getServiceClient.mockReturnValue(
      makeSupabase({
        ideaResult: { data: BASE_IDEA, error: null },
        sourcesResult: { data: null, error: null },
      }),
    );
    readConfigFile.mockResolvedValue({ content: "x", changed: null });
    renderHandoffPrompt.mockReturnValue("prompt");

    await buildDeepResearchPrompt("PI-0001");
    const call = renderHandoffPrompt.mock.calls[0][0];
    expect(call.sources).toEqual([]);
  });

  test("track=app-ideas бере criteriaDocPath саме для apps", async () => {
    getServiceClient.mockReturnValue(
      makeSupabase({
        ideaResult: { data: { ...BASE_IDEA, track: "app-ideas" }, error: null },
      }),
    );
    readConfigFile.mockImplementation(async (path: string) => ({ content: path, changed: null }));
    renderHandoffPrompt.mockReturnValue("prompt");

    await buildDeepResearchPrompt("PI-0001");
    const call = renderHandoffPrompt.mock.calls[0][0];
    expect(call.criteriaDoc).toBe("agents/criteria/external/brief-apps.md");
  });
});
