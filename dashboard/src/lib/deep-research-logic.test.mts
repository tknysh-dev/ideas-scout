import assert from "node:assert/strict";
import test from "node:test";
import type { ParsedReport } from "./deep-research-reports.ts";
import {
  MAX_BLOB_CHARS,
  buildResearchReportRows,
  buildSynthesisIdempotencyKey,
  buildVerdictRows,
  checkReportsInput,
  computeSavedCounts,
  isResearchableIdeaStatus,
  isValidIdeaId,
  selectWritableReports,
  summarizeReport,
} from "./deep-research-logic.ts";

function report(overrides: Partial<ParsedReport> = {}): ParsedReport {
  return {
    provider: "ChatGPT",
    model: "GPT-5.4",
    status: "ok",
    reportMd: "звіт",
    criteria: [],
    competitors: [],
    notes: [],
    ...overrides,
  };
}

// --- isValidIdeaId -----------------------------------------------------------

test("isValidIdeaId: коректний ID приймається", () => {
  assert.equal(isValidIdeaId("PI-1234"), true);
});

test("isValidIdeaId: рядкові літери відхиляються", () => {
  assert.equal(isValidIdeaId("pi-1234"), false);
});

test("isValidIdeaId: без цифр відхиляється", () => {
  assert.equal(isValidIdeaId("PI-"), false);
});

test("isValidIdeaId: довільний текст відхиляється", () => {
  assert.equal(isValidIdeaId("'; drop table ideas;--"), false);
});

// --- isResearchableIdeaStatus ------------------------------------------------

test("isResearchableIdeaStatus: approved_pending/accepted/rejected прийнятні", () => {
  assert.equal(isResearchableIdeaStatus("approved_pending"), true);
  assert.equal(isResearchableIdeaStatus("accepted"), true);
  assert.equal(isResearchableIdeaStatus("rejected"), true);
});

test("isResearchableIdeaStatus: new/analyzing/transferred неприйнятні", () => {
  assert.equal(isResearchableIdeaStatus("new"), false);
  assert.equal(isResearchableIdeaStatus("analyzing"), false);
  assert.equal(isResearchableIdeaStatus("transferred"), false);
});

// --- checkReportsInput --------------------------------------------------------

test("checkReportsInput: порожній масив відхиляється", () => {
  assert.match(checkReportsInput([]) ?? "", /хоча б одну/);
});

test("checkReportsInput: не масив відхиляється", () => {
  assert.match(checkReportsInput(null) ?? "", /хоча б одну/);
  assert.match(checkReportsInput("текст") ?? "", /хоча б одну/);
});

test("checkReportsInput: сумарний обсяг у межах ліміту проходить", () => {
  const reports = [{ provider: "A", text: "x".repeat(1000) }];
  assert.equal(checkReportsInput(reports), null);
});

test("checkReportsInput: сумарний обсяг понад ліміт відхиляється", () => {
  const reports = [{ provider: "A", text: "x".repeat(MAX_BLOB_CHARS + 1) }];
  assert.match(checkReportsInput(reports) ?? "", /завеликі/);
});

test("checkReportsInput: рахує суму по всіх звітах, не лише перший", () => {
  const reports = [
    { provider: "A", text: "x".repeat(MAX_BLOB_CHARS) },
    { provider: "B", text: "x" },
  ];
  assert.match(checkReportsInput(reports) ?? "", /завеликі/);
});

// --- summarizeReport -----------------------------------------------------------

test("summarizeReport: рахує критерії й конкурентів, не копіює reportMd", () => {
  const r = report({
    criteria: [{ criterion_key: "1", verdict: "passed", score: null, summary: null, detail: null, evidence: [] }],
    competitors: [{ name: "X", evidence: [] }],
    problem: "щось не так",
    notes: ["зауваження"],
  });
  const summary = summarizeReport(r);
  assert.deepEqual(summary, {
    provider: "ChatGPT",
    status: "ok",
    model: "GPT-5.4",
    criteriaCount: 1,
    competitorsCount: 1,
    problem: "щось не так",
    notes: ["зауваження"],
  });
  assert.equal((summary as unknown as { reportMd?: string }).reportMd, undefined);
});

// --- selectWritableReports -------------------------------------------------

test("selectWritableReports: відкидає лише status === 'empty'", () => {
  const reports = [report({ status: "ok" }), report({ status: "empty" }), report({ status: "refused" })];
  const writable = selectWritableReports(reports);
  assert.equal(writable.length, 2);
  assert.deepEqual(writable.map((r) => r.status), ["ok", "refused"]);
});

// --- buildResearchReportRows -------------------------------------------------

test("buildResearchReportRows: prose і ok мапляться на 'ok', refused — на 'skipped'", () => {
  const writable = [report({ status: "ok" }), report({ status: "prose" }), report({ status: "refused" })];
  const rows = buildResearchReportRows("PI-1", writable);
  assert.deepEqual(
    rows.map((r) => r.status),
    ["ok", "ok", "skipped"],
  );
});

test("buildResearchReportRows: усі рядки мають однаковий набір ключів (масовий insert)", () => {
  const writable = [report({ status: "ok" }), report({ status: "prose" }), report({ status: "refused" })];
  const rows = buildResearchReportRows("PI-1", writable);
  const keysOf = (row: (typeof rows)[number]) => Object.keys(row).sort();
  assert.deepEqual(keysOf(rows[0]), keysOf(rows[1]));
  assert.deepEqual(keysOf(rows[1]), keysOf(rows[2]));
});

// --- buildVerdictRows --------------------------------------------------------

test("buildVerdictRows: бере критерії лише зі звітів зі статусом 'ok'", () => {
  const writable = [
    report({
      status: "ok",
      criteria: [{ criterion_key: "1", verdict: "passed", score: "B", summary: null, detail: null, evidence: [] }],
    }),
    report({
      status: "prose",
      criteria: [{ criterion_key: "2", verdict: "failed", score: null, summary: null, detail: null, evidence: [] }],
    }),
  ];
  const rows = buildVerdictRows("PI-1", writable);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].criterion_key, "1");
});

test("buildVerdictRows: усі рядки мають однаковий набір ключів (масовий insert)", () => {
  const writable = [
    report({
      status: "ok",
      criteria: [
        { criterion_key: "1", verdict: "passed", score: "B", summary: "s", detail: "d", evidence: [] },
        { criterion_key: "2", verdict: "failed", score: null, summary: null, detail: null, evidence: [] },
      ],
    }),
  ];
  const rows = buildVerdictRows("PI-1", writable);
  assert.equal(rows.length, 2);
  const keysOf = (row: (typeof rows)[number]) => Object.keys(row).sort();
  assert.deepEqual(keysOf(rows[0]), keysOf(rows[1]));
});

test("buildVerdictRows: без 'ok'-звітів повертає порожній масив", () => {
  const writable = [report({ status: "prose" }), report({ status: "refused" })];
  assert.deepEqual(buildVerdictRows("PI-1", writable), []);
});

// --- buildSynthesisIdempotencyKey -------------------------------------------

test("buildSynthesisIdempotencyKey: та сама хвилина дає той самий ключ", () => {
  const t0 = Date.parse("2026-08-05T10:00:00.100Z");
  const t1 = Date.parse("2026-08-05T10:00:59.900Z");
  assert.equal(
    buildSynthesisIdempotencyKey("PI-1", t0),
    buildSynthesisIdempotencyKey("PI-1", t1),
  );
});

test("buildSynthesisIdempotencyKey: різні хвилини дають різні ключі", () => {
  const t0 = Date.parse("2026-08-05T10:00:59.999Z");
  const t1 = Date.parse("2026-08-05T10:01:00.000Z");
  assert.notEqual(
    buildSynthesisIdempotencyKey("PI-1", t0),
    buildSynthesisIdempotencyKey("PI-1", t1),
  );
});

test("buildSynthesisIdempotencyKey: формат ключа", () => {
  const t = Date.parse("2026-08-05T10:00:00.000Z");
  assert.equal(
    buildSynthesisIdempotencyKey("PI-42", t),
    `deep-research-synthesis:PI-42:${Math.floor(t / 60_000)}`,
  );
});

// --- computeSavedCounts ------------------------------------------------------

test("computeSavedCounts: рахує ok+prose як saved, refused окремо", () => {
  const writable = [report({ status: "ok" }), report({ status: "prose" }), report({ status: "refused" })];
  assert.deepEqual(computeSavedCounts(writable), { savedCount: 2, refusedCount: 1 });
});

test("computeSavedCounts: порожній масив дає нулі", () => {
  assert.deepEqual(computeSavedCounts([]), { savedCount: 0, refusedCount: 0 });
});
