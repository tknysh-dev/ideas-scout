import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCriteria, splitCriteriaSection, splitSection } from "./criteria.ts";
import type { Idea } from "./types.ts";

const idea: Idea = {
  id: "PI-0001",
  track: "passive-income",
  type: "niche",
  signal_type: "income_claim",
  status: "approved_pending",
  parent_id: null,
  title: "Test Idea",
  discovered: "2026-01-01",
  monetization_hypothesis: null,
  mentions_count: 0,
  claimed_revenue: null,
  mechanic_summary: null,
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
  min_review_interval_days: 7,
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
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const body = `## Механіка

текст механіки

## Аналіз за критеріями

**1. Довіра до джерела — пройдено (оцінка B).** Автор має живий продукт.

**2. Легальність — пройдено.** Обмежень немає.

## Інше
`;

test("без структурованих даних поведінка не змінилась", () => {
  const { section } = splitCriteriaSection(body);
  const result = analyzeCriteria(idea, section)!;
  const c1 = result.results.find((r) => r.spec.n === 1)!;
  assert.equal(c1.tone, "passed");
  assert.ok(!c1.structured, "без verdicts прапорець не виставляється");
  assert.match(c1.verdict, /пройдено/);
  // Критерій 5 не згаданий у прозі — має лишитись skipped із фолбеком.
  const c5 = result.results.find((r) => r.spec.n === 5)!;
  assert.equal(c5.tone, "skipped");
});

test("структурований вердикт перекриває тон, відновлений з прози", () => {
  const { section } = splitCriteriaSection(body);
  const structured = new Map([
    ["2", { tone: "failed" as const, summary: "провалено: знайдено прямий припис регулятора" }],
  ]);
  const result = analyzeCriteria(idea, section, structured)!;

  const c2 = result.results.find((r) => r.spec.n === 2)!;
  assert.equal(c2.tone, "failed", "дані синтезу мають переважати над регуляркою");
  assert.equal(c2.verdict, "провалено: знайдено прямий припис регулятора");
  assert.equal(c2.structured, true);
  // Проза критерію лишається на місці — синтез замінює вердикт, не пояснення.
  assert.match(c2.body, /Обмежень немає/);

  // Критерій без структурованого запису не змінився.
  const c1 = result.results.find((r) => r.spec.n === 1)!;
  assert.equal(c1.tone, "passed");
  assert.equal(c1.structured, false);
});

test("структурований вердикт з'являється там, де проза мовчала", () => {
  const { section } = splitCriteriaSection(body);
  const structured = new Map([
    ["5", { tone: "passed" as const, summary: "ринок не насичений: три живі гравці" }],
  ]);
  const result = analyzeCriteria(idea, section, structured)!;
  const c5 = result.results.find((r) => r.spec.n === 5)!;
  assert.equal(c5.tone, "passed", "критерій, який первинний аналітик пропустив, тепер оцінено");
  assert.equal(c5.verdict, "ринок не насичений: три живі гравці");
  assert.equal(c5.structured, true);
  assert.equal(c5.body, "");
});

test("порожній summary синтезу не стирає вердикт із прози", () => {
  const { section } = splitCriteriaSection(body);
  const structured = new Map([["1", { tone: "passed" as const, summary: null }]]);
  const result = analyzeCriteria(idea, section, structured)!;
  const c1 = result.results.find((r) => r.spec.n === 1)!;
  assert.match(c1.verdict, /пройдено/, "фолбек на текст аналітика, а не порожній рядок");
});

test("розділ конкурентів вирізається з прози так само, як критерії", () => {
  const card = [
    "## Механіка",
    "",
    "опис механіки",
    "",
    "## Конкуренти",
    "",
    "Notevision — живий, $3.99 разово.",
    "",
    "## Джерела",
    "",
    "посилання",
  ].join("\n");

  const { section, rest } = splitSection(card, "Конкуренти");
  assert.match(section!, /Notevision/);
  assert.doesNotMatch(rest, /Notevision/, "сторінка показує конкурентів структурованим списком, не прозою");
  assert.match(rest, /опис механіки/, "решта картки лишається недоторканою");
  assert.match(rest, /посилання/);
});

test("картка без розділу конкурентів лишається як була", () => {
  const card = "## Механіка\n\nопис механіки";
  const { section, rest } = splitSection(card, "Конкуренти");
  assert.equal(section, null);
  assert.equal(rest, card);
});
