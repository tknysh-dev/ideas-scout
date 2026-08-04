import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildIdeaContext,
  criteriaDocPath,
  renderHandoffPrompt,
} from "./deep-research-prompt.ts";

const repoFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf-8");

const idea: any = {
  id: "PI-0013",
  title: "Каталог шаблонів Notion",
  type: "niche",
  track: "passive-income",
  signal_type: "income_claim",
  claimed_revenue: "$1200/міс",
  mechanic_summary: "продаж шаблонів",
  monetization_hypothesis: "разова покупка",
  body: `## Механіка

опис механіки

## Аналіз за критеріями

**1. Довіра до джерела — пройдено.**
`,
};

const sources: any[] = [
  { url: "https://example.com/post", published_date: "2026-01-15", author_interest: "affiliate" },
];

test("контекст ідеї не містить чужого вердикту за критеріями", () => {
  const context = buildIdeaContext(idea, sources);
  assert.match(context, /id: PI-0013/);
  assert.match(context, /опис механіки/);
  assert.doesNotMatch(context, /Довіра до джерела/);
  assert.match(context, /https:\/\/example\.com\/post \(дата: 2026-01-15/);
});

test("плейсхолдери підставлені, мітка дослідника лишається власнику", () => {
  const prompt = renderHandoffPrompt({
    idea,
    sources,
    template: repoFile("agents/prompts/deep-research-handoff.md"),
    criteriaDoc: repoFile(criteriaDocPath("passive-income")),
    deepDoc: repoFile("agents/criteria/deep-research.md"),
    today: "2026-08-04",
  });

  assert.doesNotMatch(prompt, /Цей файл — шаблон/);
  assert.match(prompt, /^## Хто ти в цьому завданні/m);
  assert.match(prompt, /заробітку `PI-0013` \(трек `passive-income`\)/);
  assert.match(prompt, /Сьогодні 2026-08-04/);
  assert.match(prompt, /разом 14 об'єктів/);
  assert.match(prompt, /DEEP RESEARCH REPORT START \| \{\{RESEARCHER_LABEL\}\} \| PI-0013/);
  // Будь-який інший незамінений плейсхолдер означає розсинхрон шаблону й коду.
  assert.deepEqual(
    [...new Set(prompt.match(/\{\{[A-Z_]+\}\}/g))],
    ["{{RESEARCHER_LABEL}}"],
  );
});

test("трек app-ideas очікує на один базовий критерій більше", () => {
  const prompt = renderHandoffPrompt({
    idea: { ...idea, track: "app-ideas" },
    sources: [],
    template: repoFile("agents/prompts/deep-research-handoff.md"),
    criteriaDoc: repoFile(criteriaDocPath("app-ideas")),
    deepDoc: repoFile("agents/criteria/deep-research.md"),
    today: "2026-08-04",
  });
  assert.match(prompt, /разом 15 об'єктів/);
  assert.match(prompt, /"7" \| "d_demand"/);
});

test("трек без чек-листа критеріїв не дає промпта", () => {
  assert.throws(
    () =>
      renderHandoffPrompt({
        idea: { ...idea, track: "crypto" },
        sources: [],
        template: "{{IDEA_ID}}",
        criteriaDoc: "",
        deepDoc: "",
        today: "2026-08-04",
      }),
    /чек-листа критеріїв/,
  );
});
