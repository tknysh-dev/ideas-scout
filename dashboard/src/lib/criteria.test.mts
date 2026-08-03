import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCriteria, splitCriteriaSection } from "./criteria.ts";

const idea: any = {
  id: "PI-0001",
  track: "passive-income",
  type: "niche",
  signal_type: "income_claim",
  status: "approved_pending",
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
