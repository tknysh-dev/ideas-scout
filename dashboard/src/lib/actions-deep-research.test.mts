// Накриває server actions у src/lib/actions/deep-research.ts (fetchDeepResearchPrompt,
// previewDeepResearchReports, commitDeepResearchReports, fetchKnownResearcherModels) —
// раніше 0% покриття, тестувалась лише винесена логіка (deep-research-logic.ts).
//
// Імпортується напряму через ESM-хук actions-deep-research.hooks.mjs, без жодної
// зміни самого actions/deep-research.ts. Хук підміняє лише резолюцію імпортів
// (owner.server, deep-research-prompt.server, supabase-клієнт, revalidatePath).
// Див. коментар у хуку.

import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { register } from "node:module";

register("./actions-deep-research.hooks.mjs", import.meta.url);

const { mockState, resetMockService } = await import("./actions-test-mock-service.mts");
const { mockOwnerState, resetMockOwner } = await import("./actions-deep-research.mock-owner.mts");
const { mockPromptState, resetMockPromptServer } = await import(
  "./actions-deep-research.mock-prompt-server.mts"
);
const { mockCacheState, resetMockCache } = await import("./actions-test-mock-next-cache.mts");
const {
  fetchDeepResearchPrompt,
  previewDeepResearchReports,
  commitDeepResearchReports,
  fetchKnownResearcherModels,
} = await import("./actions/deep-research.ts");

beforeEach(() => {
  resetMockService();
  resetMockOwner();
  resetMockPromptServer();
  resetMockCache();
});

afterEach(() => {
  resetMockService();
  resetMockOwner();
  resetMockPromptServer();
  resetMockCache();
});

const IDEA_ID = "PI-1234";
const researchableIdea = { id: IDEA_ID, status: "approved_pending", track: "passive-income" };

function jsonBlock(payload: unknown) {
  return "```json\n" + JSON.stringify(payload, null, 2) + "\n```";
}

const goodPayload = {
  criteria: [
    {
      criterion_key: "1",
      verdict: "passed",
      score: "B",
      summary: "Джерело витримує перевірку",
      detail: "Автор показав живий продукт.",
      evidence: [],
    },
  ],
  competitors: [],
};

const okReport = { provider: "ChatGPT", text: `Звіт.\n\n${jsonBlock(goodPayload)}` };
const proseReport = { provider: "ChatGPT", text: "Просто текст без json-блоку." };

// --- fetchDeepResearchPrompt: гілки loadResearchableIdea + власні -----------

test("fetchDeepResearchPrompt: власник не авторизований -> помилка власника", async () => {
  mockOwnerState.result = { error: "Потрібен вхід у дашборд." };
  const result = await fetchDeepResearchPrompt(IDEA_ID);
  assert.equal(result.error, "Потрібен вхід у дашборд.");
  assert.equal(mockState.calls.length, 0);
});

test("fetchDeepResearchPrompt: некоректний ID ідеї -> помилка формату, Supabase не викликається", async () => {
  const result = await fetchDeepResearchPrompt("not-an-id");
  assert.equal(result.error, "Некоректний ID ідеї.");
  assert.equal(mockState.calls.length, 0);
});

test("fetchDeepResearchPrompt: немає доступу до бази -> помилка", async () => {
  mockState.clientAvailable = false;
  const result = await fetchDeepResearchPrompt(IDEA_ID);
  assert.equal(result.error, "Немає доступу до бази.");
});

test("fetchDeepResearchPrompt: помилка читання ідеї -> текст Supabase у повідомленні", async () => {
  mockState.queue = [{ data: null, error: { message: "timeout" } }];
  const result = await fetchDeepResearchPrompt(IDEA_ID);
  assert.equal(result.error, "Не вдалося перевірити ідею: timeout");
});

test("fetchDeepResearchPrompt: ідею не знайдено -> «Ідею не знайдено.»", async () => {
  mockState.queue = [{ data: null, error: null }];
  const result = await fetchDeepResearchPrompt(IDEA_ID);
  assert.equal(result.error, "Ідею не знайдено.");
});

test("fetchDeepResearchPrompt: статус не дозволяє дослідження -> помилка стадії", async () => {
  mockState.queue = [{ data: { ...researchableIdea, status: "new" }, error: null }];
  const result = await fetchDeepResearchPrompt(IDEA_ID);
  assert.equal(result.error, "Глибоке дослідження доступне після первинної оцінки ідеї.");
});

test("fetchDeepResearchPrompt: успіх -> промпт від buildDeepResearchPrompt", async () => {
  mockState.queue = [{ data: researchableIdea, error: null }];
  mockPromptState.result = { prompt: "ЗІБРАНИЙ ПРОМПТ" };
  const result = await fetchDeepResearchPrompt(IDEA_ID);
  assert.deepEqual(result, { prompt: "ЗІБРАНИЙ ПРОМПТ" });
});

// --- previewDeepResearchReports ---------------------------------------------

test("previewDeepResearchReports: власник не авторизований -> помилка власника", async () => {
  mockOwnerState.result = { error: "Потрібен вхід у дашборд." };
  const result = await previewDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, "Потрібен вхід у дашборд.");
});

test("previewDeepResearchReports: порожній список звітів -> помилка вхідних даних", async () => {
  const result = await previewDeepResearchReports(IDEA_ID, []);
  assert.equal(result.error, "Додайте хоча б одну відповідь моделі.");
  assert.equal(mockState.calls.length, 0);
});

test("previewDeepResearchReports: ідею не знайдено -> помилка ідеї", async () => {
  mockState.queue = [{ data: null, error: null }];
  const result = await previewDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, "Ідею не знайдено.");
});

test("previewDeepResearchReports: трек без чек-листа критеріїв -> помилка розбору", async () => {
  mockState.queue = [{ data: { ...researchableIdea, track: "unknown-track" }, error: null }];
  const result = await previewDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, "Трек «unknown-track» не має чек-листа критеріїв.");
});

test("previewDeepResearchReports: успіх -> перелік розібраних звітів і validCount", async () => {
  mockState.queue = [{ data: researchableIdea, error: null }];
  const result = await previewDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, undefined);
  assert.equal(result.validCount, 1);
  assert.equal(result.reports?.[0].status, "ok");
});

// --- commitDeepResearchReports: усі гілки Supabase-послідовності -----------

test("commitDeepResearchReports: власник не авторизований -> помилка власника", async () => {
  mockOwnerState.result = { error: "Потрібен вхід у дашборд." };
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, "Потрібен вхід у дашборд.");
});

test("commitDeepResearchReports: порожній список звітів -> помилка вхідних даних", async () => {
  const result = await commitDeepResearchReports(IDEA_ID, []);
  assert.equal(result.error, "Додайте хоча б одну відповідь моделі.");
});

test("commitDeepResearchReports: ідею не знайдено -> помилка ідеї", async () => {
  mockState.queue = [{ data: null, error: null }];
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, "Ідею не знайдено.");
});

test("commitDeepResearchReports: трек без чек-листа критеріїв -> помилка розбору", async () => {
  mockState.queue = [{ data: { ...researchableIdea, track: "unknown-track" }, error: null }];
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, "Трек «unknown-track» не має чек-листа критеріїв.");
});

test("commitDeepResearchReports: усі звіти порожні (usableCount 0) -> «нема з чого зводити вердикт»", async () => {
  mockState.queue = [{ data: researchableIdea, error: null }];
  const result = await commitDeepResearchReports(IDEA_ID, [{ provider: "ChatGPT", text: "" }]);
  assert.match(result.error ?? "", /немає жодного придатного до консолідації/);
});

test("commitDeepResearchReports: доступ до бази зникає між читанням ідеї й записом -> «Немає доступу до бази.»", async () => {
  // Симулює середовище, яке стало недоступним між двома незалежними
  // getServiceClient()-викликами всередині однієї дії (loadResearchableIdea і
  // сам commitDeepResearchReports) — реальний сценарій без стороннього стану
  // всередині одного запиту недосяжний, тому це саме тест другого виклику.
  mockState.queue = [
    {
      data: researchableIdea,
      error: null,
      onConsumed: () => {
        mockState.clientAvailable = false;
      },
    },
  ];
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, "Немає доступу до бази.");
});

test("commitDeepResearchReports: помилка витіснення попередньої консолідації", async () => {
  mockState.queue = [
    { data: researchableIdea, error: null },
    { error: null }, // criteria_verdicts update (cleanup)
    { error: { message: "deadlock detected" } }, // research_reports update (cleanup)
  ];
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, "Не вдалося витіснити попередню консолідацію: deadlock detected");
});

test("commitDeepResearchReports: помилка запису звітів", async () => {
  mockState.queue = [
    { data: researchableIdea, error: null },
    { error: null },
    { error: null },
    { error: { message: "insert failed" } }, // research_reports insert
  ];
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, "Не вдалося зберегти звіти: insert failed");
});

test("commitDeepResearchReports: звіт без критеріїв (проза) -> вердиктів 0, insert вердиктів не викликається", async () => {
  mockState.queue = [
    { data: researchableIdea, error: null },
    { error: null },
    { error: null },
    { error: null }, // research_reports insert
    { data: { id: "JOB-1" }, error: null }, // jobs insert
  ];
  const result = await commitDeepResearchReports(IDEA_ID, [proseReport]);
  assert.equal(result.error, undefined);
  assert.equal(result.verdictCount, 0);
  assert.ok(!mockState.calls.some((c) => c.table === "criteria_verdicts" && c.method === "insert"));
});

test("commitDeepResearchReports: помилка запису структурованих вердиктів", async () => {
  mockState.queue = [
    { data: researchableIdea, error: null },
    { error: null },
    { error: null },
    { error: null }, // research_reports insert
    { error: { message: "constraint violation" } }, // criteria_verdicts insert
  ];
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.match(result.error ?? "", /структуровані вердикти — ні: constraint violation/);
});

test("commitDeepResearchReports: успіх, дубль idempotency-ключа (23505) -> alreadyQueued", async () => {
  mockState.queue = [
    { data: researchableIdea, error: null },
    { error: null },
    { error: null },
    { error: null }, // research_reports insert
    { error: null }, // criteria_verdicts insert
    { data: null, error: { code: "23505", message: "duplicate" } }, // jobs insert
    { data: { id: "JOB-OLD" }, error: null }, // jobs select existing
  ];
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, undefined);
  assert.equal(result.alreadyQueued, true);
  assert.equal(result.jobId, "JOB-OLD");
});

test("commitDeepResearchReports: помилка постановки в чергу (не 23505) -> звіти збережено, але помилка", async () => {
  mockState.queue = [
    { data: researchableIdea, error: null },
    { error: null },
    { error: null },
    { error: null },
    { error: null },
    { data: null, error: { code: "OTHER", message: "queue down" } }, // jobs insert
  ];
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.match(result.error ?? "", /синтез не поставився в чергу: queue down/);
  assert.equal(result.savedCount, 1);
});

test("commitDeepResearchReports: повний успіх -> jobId, лічильники, revalidatePath двічі", async () => {
  mockState.queue = [
    { data: researchableIdea, error: null },
    { error: null },
    { error: null },
    { error: null },
    { error: null },
    { data: { id: "JOB-NEW" }, error: null },
  ];
  const result = await commitDeepResearchReports(IDEA_ID, [okReport]);
  assert.equal(result.error, undefined);
  assert.equal(result.jobId, "JOB-NEW");
  assert.equal(result.savedCount, 1);
  assert.equal(result.verdictCount, 1);
  assert.deepEqual(mockCacheState.calls, [[`/ideas/${IDEA_ID}`], ["/runs"]]);
});

// --- fetchKnownResearcherModels ----------------------------------------------

test("fetchKnownResearcherModels: власник не авторизований -> порожній словник без звернень до бази", async () => {
  mockOwnerState.result = { error: "нема доступу" };
  const result = await fetchKnownResearcherModels();
  assert.deepEqual(result, {});
  assert.equal(mockState.calls.length, 0);
});

test("fetchKnownResearcherModels: немає доступу до бази -> порожній словник", async () => {
  mockState.clientAvailable = false;
  const result = await fetchKnownResearcherModels();
  assert.deepEqual(result, {});
});

test("fetchKnownResearcherModels: data відсутнє (null) -> порожній словник, не падає", async () => {
  mockState.queue = [{ data: null, error: null }];
  const result = await fetchKnownResearcherModels();
  assert.deepEqual(result, {});
});

test("fetchKnownResearcherModels: рядки без provider/model відкидаються, дублікати моделі не повторюються", async () => {
  mockState.queue = [
    {
      data: [
        { provider: "chatgpt", model: "gpt-5" },
        { provider: "chatgpt", model: "gpt-5" }, // дублікат моделі того самого провайдера
        { provider: "", model: "orphan-model" }, // немає провайдера
        { provider: "grok", model: "" }, // немає моделі
        { provider: null, model: null },
      ],
      error: null,
    },
  ];
  const result = await fetchKnownResearcherModels();
  assert.deepEqual(result, { chatgpt: ["gpt-5"] });
});
