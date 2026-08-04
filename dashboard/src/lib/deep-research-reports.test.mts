import assert from "node:assert/strict";
import test from "node:test";
import { parseReports, sanitizeLabel } from "./deep-research-reports.ts";

const TRACK = "passive-income";

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
      evidence: [{ url: "https://example.com/a", published_date: "2026-02-01", quote: "цитата" }],
    },
    {
      criterion_key: "d_demand",
      verdict: "noted",
      summary: "Попит є, але тонкий",
      detail: "Кілька гілок обговорень за рік.",
      evidence: [],
    },
  ],
  competitors: [
    { name: "Конкурент", url: "https://example.com/c", liveness: "active", evidence: [] },
  ],
};

const parse = (reports: { provider: string; model?: string; text: string }[]) =>
  parseReports({ track: TRACK, reports });

test("кілька провайдерів розбираються окремо", () => {
  const result = parse([
    { provider: "ChatGPT", model: "GPT-5.4", text: `Звіт.\n\n${jsonBlock(goodPayload)}` },
    { provider: "DeepSeek", text: `Інший звіт.\n\n${jsonBlock(goodPayload)}` },
  ]);

  assert.equal(result.error, undefined);
  assert.equal(result.usableCount, 2);
  assert.deepEqual(result.reports.map((r) => r.provider), ["ChatGPT", "DeepSeek"]);
  assert.equal(result.reports[0].model, "GPT-5.4");
  assert.equal(result.reports[1].model, null, "модель необовʼязкова");
  assert.equal(result.reports[0].criteria.length, 2);
  assert.equal(result.reports[0].competitors.length, 1);
});

test("вербатим-текст зберігається як є — його читає синтез", () => {
  const result = parse([{ provider: "ChatGPT", text: `Прозовий звіт.\n\n${jsonBlock(goodPayload)}` }]);
  assert.match(result.reports[0].reportMd, /Прозовий звіт/);
  assert.match(result.reports[0].reportMd, /```json/);
});

// Головна причина переробки: звіт без валідного JSON коштував години роботи.
test("звіт без json-блоку не пропадає, а йде в синтез прозою", () => {
  const result = parse([{ provider: "Gemini", text: "Докладний звіт без жодного блоку коду." }]);
  const report = result.reports[0];
  assert.equal(report.status, "prose");
  assert.equal(result.usableCount, 1, "прозовий звіт усе одно придатний до консолідації");
  assert.match(report.problem!, /піде в синтез як текст/);
  assert.equal(report.criteria.length, 0);
});

test("побитий json теж лишає звіт придатним", () => {
  const result = parse([{ provider: "Grok", text: "Текст.\n\n```json\n{ criteria: [oops\n```" }]);
  assert.equal(result.reports[0].status, "prose");
  assert.equal(result.usableCount, 1);
});

test("json за чужою схемою дає прозовий статус, а не тихий нуль вердиктів", () => {
  const result = parse([
    { provider: "Qwen", text: `Текст.\n\n${jsonBlock({ verdicts: [{ n: 1, ok: true }] })}` },
  ]);
  assert.equal(result.reports[0].status, "prose");
  assert.match(result.reports[0].problem!, /за власною схемою/);
});

test("відмова через відсутній пошук розпізнається окремо", () => {
  const result = parse([{ provider: "DeepSeek", text: "SEARCH UNAVAILABLE" }]);
  assert.equal(result.reports[0].status, "refused");
  assert.equal(result.usableCount, 0, "у синтез відмова не йде");
});

test("порожнє поле не стає звітом", () => {
  const result = parse([
    { provider: "ChatGPT", text: `Звіт.\n\n${jsonBlock(goodPayload)}` },
    { provider: "Gemini", text: "   " },
  ]);
  assert.equal(result.reports[1].status, "empty");
  assert.equal(result.usableCount, 1);
});

test("критерій поза білим списком треку відкидається, решта звіту лишається", () => {
  const result = parse([
    {
      provider: "ChatGPT",
      text: jsonBlock({
        criteria: [
          ...goodPayload.criteria,
          { criterion_key: "99", verdict: "passed", summary: "-", detail: "-", evidence: [] },
          { criterion_key: "2", verdict: "вигадка", summary: "-", detail: "-", evidence: [] },
        ],
        competitors: [],
      }),
    },
  ]);
  const report = result.reports[0];
  assert.equal(report.status, "ok");
  assert.deepEqual(report.criteria.map((c) => c.criterion_key), ["1", "d_demand"]);
  assert.ok(report.notes.some((note) => /відкинуто/.test(note)));
});

// Провайдер — частина ключа в базі, тож два звіти від одного сервісу
// перезаписали б один одного.
test("той самий провайдер двічі — помилка, а не тиха втрата звіту", () => {
  const result = parse([
    { provider: "ChatGPT", text: "Перший." },
    { provider: "ChatGPT", text: "Другий." },
  ]);
  assert.match(result.error!, /обраний двічі/);
  assert.equal(result.reports.length, 0);
});

test("порожній провайдер не приймається", () => {
  const result = parse([{ provider: "   ", text: "Звіт." }]);
  assert.match(result.error!, /обраний провайдер/);
});

test("невідомий трек не дає розбору", () => {
  const result = parseReports({ track: "crypto", reports: [{ provider: "ChatGPT", text: "x" }] });
  assert.match(result.error!, /чек-листа критеріїв/);
});

test("мітка провайдера чиститься від керівних символів і обрізається", () => {
  assert.equal(sanitizeLabel(" Chat\nGPT "), "Chat GPT");
  assert.equal(sanitizeLabel("x".repeat(300)).length, 100);
});

// Поломки форматування передбачувані, і кожна з них раніше коштувала цілої
// вкладки з вердиктами, хоча дані в блоці були.
const criteriaJson = JSON.stringify(goodPayload, null, 2);

test("огорожа з іншим регістром або пробілом усе одно читається", () => {
  for (const fence of ["```JSON", "``` json", "```Json"]) {
    const result = parse([{ provider: "ChatGPT", text: `Текст.\n\n${fence}\n${criteriaJson}\n\`\`\`` }]);
    assert.equal(result.reports[0].status, "ok", fence);
    assert.equal(result.reports[0].criteria.length, 2);
  }
});

test("огорожа без назви мови теж читається", () => {
  const result = parse([{ provider: "ChatGPT", text: "Текст.\n\n```\n" + criteriaJson + "\n```" }]);
  assert.equal(result.reports[0].status, "ok");
});

test("незакрита огорожа не втрачає блок", () => {
  const result = parse([{ provider: "ChatGPT", text: "Текст.\n\n```json\n" + criteriaJson }]);
  const report = result.reports[0];
  assert.equal(report.status, "ok");
  assert.ok(report.notes.some((n) => /не була закрита/.test(n)), "про ремонт сказано власнику");
});

test("зайва кома перед дужкою лагодиться", () => {
  const broken = criteriaJson.replace(/\}\s*\]/, "},\n  ]");
  const result = parse([{ provider: "ChatGPT", text: "```json\n" + broken + "\n```" }]);
  assert.equal(result.reports[0].status, "ok");
  assert.ok(result.reports[0].notes.some((n) => /зайві коми/.test(n)));
});

test("проза всередині блоку не заважає", () => {
  const result = parse([
    { provider: "ChatGPT", text: "```json\nОсь підсумок:\n" + criteriaJson + "\nСподіваюсь, допоміг.\n```" },
  ]);
  assert.equal(result.reports[0].status, "ok");
  assert.ok(result.reports[0].notes.some((n) => /зайва проза/.test(n)));
});

test("блок, обірваний на середині, дає те, що встигло дійти", () => {
  const truncated = criteriaJson.slice(0, criteriaJson.indexOf('"d_demand"') + 40);
  const result = parse([{ provider: "ChatGPT", text: "```json\n" + truncated }]);
  const report = result.reports[0];
  assert.equal(report.status, "ok");
  assert.ok(report.criteria.length >= 1, "перший критерій уцілів");
  assert.ok(report.notes.some((n) => /обірвався/.test(n)));
});

// Межа поблажливості: лагодимо форму, ніколи не зміст.
test("вигаданий вердикт ремонт не рятує — такий запис відкидається", () => {
  const result = parse([
    {
      provider: "ChatGPT",
      text: "```json\n" + JSON.stringify({
        criteria: [{ criterion_key: "1", verdict: "майже пройдено", summary: "-", detail: "-", evidence: [] }],
        competitors: [],
      }) + "\n```",
    },
  ]);
  assert.equal(result.reports[0].status, "prose", "у синтез іде прозою, а не вигаданим вердиктом");
});

test("текст без жодного обʼєкта лишається прозою", () => {
  const result = parse([{ provider: "ChatGPT", text: "Просто звіт без будь-якої структури." }]);
  assert.equal(result.reports[0].status, "prose");
});

// Помітка про ремонт має з'являтись лише тоді, коли ремонт справді був:
// інакше вона знецінюється й перестає привертати увагу там, де потрібна.
test("цілий блок не отримує помітки про ремонт", () => {
  const result = parse([{ provider: "ChatGPT", text: `Звіт.\n\n${jsonBlock(goodPayload)}` }]);
  assert.equal(result.reports[0].status, "ok");
  assert.ok(
    !result.reports[0].notes.some((n) => /полагодити/.test(n)),
    "нічого не ламалось — нема про що попереджати",
  );
});
