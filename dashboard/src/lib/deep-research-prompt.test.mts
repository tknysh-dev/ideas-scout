import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEEP_CRITERIA_DOC_PATH,
  buildIdeaContext,
  criteriaDocPath,
  renderHandoffPrompt,
  type IdeaContextInput,
  type SourceContextInput,
} from "./deep-research-prompt.ts";

const repoFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), "utf-8");

const idea: IdeaContextInput = {
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

const sources: SourceContextInput[] = [
  { url: "https://example.com/post", published_date: "2026-01-15", author_interest: "affiliate" },
];

test("контекст ідеї не містить чужого вердикту за критеріями", () => {
  const context = buildIdeaContext(idea, sources);
  assert.match(context, /id: PI-0013/);
  assert.match(context, /опис механіки/);
  assert.doesNotMatch(context, /Довіра до джерела/);
  assert.match(
    context,
    /https:\/\/example\.com\/post \(дата: 2026-01-15, автор отримує партнерську комісію з посилань на продукт\)/,
  );
});

test("усі плейсхолдери підставлені", () => {
  const prompt = renderHandoffPrompt({
    idea,
    sources,
    template: repoFile("agents/prompts/deep-research-handoff.md"),
    criteriaDoc: repoFile(criteriaDocPath("passive-income")),
    deepDoc: repoFile(DEEP_CRITERIA_DOC_PATH),
    today: "2026-08-04",
  });

  assert.doesNotMatch(prompt, /Цей файл — шаблон/);
  assert.match(prompt, /^## Хто ти в цьому завданні/m);
  assert.match(prompt, /заробітку `PI-0013`/);
  assert.match(prompt, /категорія: механіки пасивного доходу/);
  assert.match(prompt, /Сьогодні 2026-08-04/);
  assert.match(prompt, /разом 14 об'єктів/);
  // Незамінений плейсхолдер означає розсинхрон шаблону й коду: модель отримала б
  // його дослівно замість даних.
  assert.equal(prompt.match(/\{\{[A-Z_]+\}\}/g), null);
});

test("трек app-ideas очікує на один базовий критерій більше", () => {
  const prompt = renderHandoffPrompt({
    idea: { ...idea, track: "app-ideas" },
    sources: [],
    template: repoFile("agents/prompts/deep-research-handoff.md"),
    criteriaDoc: repoFile(criteriaDocPath("app-ideas")),
    deepDoc: repoFile(DEEP_CRITERIA_DOC_PATH),
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

// Зовнішня модель не має бачити внутрішню кухню проєкту: шляхи репозиторію,
// назви полів бази й коди відхилення, якими оперує лише синтезатор.
test("згенерований промпт не містить внутрішньої кухні бази й репозиторію", () => {
  const prompt = renderHandoffPrompt({
    idea,
    sources,
    template: repoFile("agents/prompts/deep-research-handoff.md"),
    criteriaDoc: repoFile(criteriaDocPath("passive-income")),
    deepDoc: repoFile(DEEP_CRITERIA_DOC_PATH),
    today: "2026-08-04",
  });

  const forbidden = [
    "agents/",
    "shared/",
    "dashboard/",
    "PLAN.md",
    "rejection_code",
    "signal_type",
    "ceiling_flag",
    "research_depth",
    "NO_MONETIZATION",
    "SATURATED",
    "CAPABILITY_GAP",
    // Назви треків — теж значення поля БД: шаблон колись підставляв їх у
    // перший же рядок повз усе олюднення контексту.
    "passive-income",
    "app-ideas",
    "automation_report",
    "income_claim",
    // author_interest (shared/schema.sql, таблиця sources) — так само поле БД,
    // сирі значення якого не мають потрапляти у чуже вікно моделі.
    "author_interest",
    "affiliate",
    "course_seller",
    "tool_vendor",
  ];
  for (const word of forbidden) {
    assert.doesNotMatch(prompt, new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("службова шапка зовнішнього брифа не потрапляє у згенерований промпт", () => {
  const rawCriteriaDoc = repoFile(criteriaDocPath("passive-income"));
  const separator = rawCriteriaDoc.match(/^---\s*$/m);
  assert.ok(separator, "зовнішній бриф має службову шапку, відокремлену `---`");
  const header = rawCriteriaDoc.slice(0, separator!.index).trim();
  const body = rawCriteriaDoc.slice(separator!.index! + separator![0].length).trimStart();
  assert.ok(header.length > 0, "шапка не порожня — інакше перевірка нічого не варта");

  const prompt = renderHandoffPrompt({
    idea,
    sources,
    template: repoFile("agents/prompts/deep-research-handoff.md"),
    criteriaDoc: rawCriteriaDoc,
    deepDoc: repoFile(DEEP_CRITERIA_DOC_PATH),
    today: "2026-08-04",
  });

  assert.ok(!prompt.includes(header), "шапка брифа не має потрапити в промпт");
  assert.ok(prompt.includes(body.split("\n")[0]), "тіло брифа має потрапити в промпт");
});

// Незалежність дослідження тримається на тому, що дослідник не бачить чужих
// висновків. Розділ критеріїв ховали з самого початку, а конкурентів — ні:
// готова картина конкурентного поля попереднього прогону їхала в промпт.
test("висновки попереднього прогону не потрапляють у контекст ідеї", () => {
  const withPriorRun: IdeaContextInput = {
    ...idea,
    body: [
      "## Механіка",
      "",
      "опис механіки",
      "",
      "## Аналіз за критеріями",
      "",
      "**1. Довіра до джерела — пройдено.**",
      "",
      "## Конкуренти",
      "",
      "Notevision — живий, 3.2 тисячі оцінок; ніша зайнята сильніше, ніж вважалось.",
    ].join("\n"),
  };

  const context = buildIdeaContext(withPriorRun, []);
  assert.match(context, /опис механіки/, "власний опис механіки лишається");
  assert.doesNotMatch(context, /Довіра до джерела/, "чужий вердикт за критеріями прихований");
  assert.doesNotMatch(context, /Notevision/, "чужа картина конкурентів так само прихована");
  assert.doesNotMatch(context, /ніша зайнята/);
});

// Приклад назви поруч із плейсхолдером читається моделлю як зразок відповіді:
// саме так DeepSeek підписався ChatGPT-ом.
test("у тілі промпта немає назв сторонніх сервісів, які модель могла б скопіювати", () => {
  const prompt = renderHandoffPrompt({
    idea,
    sources,
    template: repoFile("agents/prompts/deep-research-handoff.md"),
    criteriaDoc: repoFile(criteriaDocPath("passive-income")),
    deepDoc: repoFile(DEEP_CRITERIA_DOC_PATH),
    today: "2026-08-04",
  });
  for (const name of ["ChatGPT", "Gemini", "Perplexity", "Grok", "GPT-5"]) {
    assert.doesNotMatch(prompt, new RegExp(name), `${name} не має траплятись у промпті`);
  }
});
