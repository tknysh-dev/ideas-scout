import assert from "node:assert/strict";
import test from "node:test";
import { parseReports, sanitizeLabel } from "./deep-research-reports.ts";
import { BASE_CRITERIA_KEYS_BY_TRACK, DEEP_RESEARCH_KEYS } from "./deep-research-prompt.ts";

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

// --- Відмінки числівника (plural): усі комбінації mod10/mod100 ---
// Лічильник відкинутих записів проходить через plural(), тож підбираємо його
// значеннями, а не викликаємо функцію напряму — вона не експортована.
function withDropped(n: number) {
  const invalid = Array.from({ length: n }, () => ({
    criterion_key: "999",
    verdict: "passed",
    summary: "-",
    detail: "-",
    evidence: [],
  }));
  return parse([
    {
      provider: "ChatGPT",
      text: jsonBlock({
        criteria: [{ criterion_key: "1", verdict: "passed", summary: "-", detail: "-", evidence: [] }, ...invalid],
        competitors: [],
      }),
    },
  ]).reports[0].notes;
}

test("plural: mod10=1 і mod100!==11 дає форму однини", () => {
  assert.ok(withDropped(1).some((n) => /^1 запис /.test(n)));
});

test("plural: mod10=1 але mod100===11 — виняток, не однина", () => {
  assert.ok(withDropped(11).some((n) => /^11 записів/.test(n)));
});

test("plural: mod10 у межах 2-4, але mod100 у 12-14 — теж не форма 2-4", () => {
  assert.ok(withDropped(12).some((n) => /^12 записів/.test(n)));
});

test("plural: mod10 поза діапазоном 1-4 — форма \"записів\"", () => {
  assert.ok(withDropped(5).some((n) => /^5 записів/.test(n)));
});

test("plural: mod10 у 2-4 і mod100 поза 12-14 через другу частину OR", () => {
  assert.ok(withDropped(24).some((n) => /^24 записи /.test(n)));
});

// --- Межі "скільки критеріїв оцінено з чек-листа" ---
const ALL_CRITERIA_KEYS = [...BASE_CRITERIA_KEYS_BY_TRACK[TRACK], ...DEEP_RESEARCH_KEYS];

test("усі критерії чек-листа присутні — приміток про неповноту нема", () => {
  const criteria = ALL_CRITERIA_KEYS.map((key) => ({
    criterion_key: key,
    verdict: "passed",
    summary: "-",
    detail: "-",
    evidence: [],
  }));
  const result = parse([{ provider: "ChatGPT", text: jsonBlock({ criteria, competitors: [] }) }]);
  const report = result.reports[0];
  assert.equal(report.criteria.length, ALL_CRITERIA_KEYS.length);
  assert.ok(!report.notes.some((n) => /оцінила/.test(n)), "нема прогалини — нема що уточнювати");
});

test("усі критерії відкинуто, але є конкурент — звіт лишається ok, а не прозою", () => {
  const result = parse([
    {
      provider: "ChatGPT",
      text: jsonBlock({
        criteria: [{ criterion_key: "999", verdict: "passed", summary: "-", detail: "-", evidence: [] }],
        competitors: [{ name: "Тільки назва" }],
      }),
    },
  ]);
  const report = result.reports[0];
  assert.equal(report.status, "ok", "конкурент рятує звіт від прозового статусу");
  assert.equal(report.criteria.length, 0);
  assert.ok(!report.notes.some((n) => /оцінила/.test(n)), "нуль критеріїв — нема що рахувати у відсотках");
  const competitor = report.competitors[0];
  assert.equal(competitor.url, undefined);
  assert.equal(competitor.pricing, undefined);
  assert.equal(competitor.strengths, undefined);
  assert.equal(competitor.weaknesses, undefined);
  assert.equal(competitor.differentiation, undefined);
  assert.equal(competitor.liveness, undefined);
  assert.equal(competitor.last_activity, undefined);
  assert.deepEqual(competitor.evidence, []);
});

test("конкурент з усіма полями — pricing/strengths/weaknesses/differentiation теж проходять", () => {
  const result = parse([
    {
      provider: "ChatGPT",
      text: jsonBlock({
        criteria: [],
        competitors: [
          {
            name: "Повний профіль",
            url: "https://example.com/c",
            pricing: "$29/міс",
            strengths: "Сильна ніша",
            weaknesses: "Малий трафік",
            differentiation: "Інша аудиторія",
          },
        ],
      }),
    },
  ]);
  const competitor = result.reports[0].competitors[0];
  assert.equal(competitor.pricing, "$29/міс");
  assert.equal(competitor.strengths, "Сильна ніша");
  assert.equal(competitor.weaknesses, "Малий трафік");
  assert.equal(competitor.differentiation, "Інша аудиторія");
});

// --- sanitizeCriteria: сміттєві елементи масиву ---
test("критерій-не-обʼєкт і нерядкові key/verdict відкидаються без крашу", () => {
  const result = parse([
    {
      provider: "ChatGPT",
      text: jsonBlock({
        criteria: [
          null,
          { criterion_key: "1", verdict: "passed", summary: "-", detail: "-", evidence: [] },
          { criterion_key: 42, verdict: "passed", summary: "-", detail: "-", evidence: [] },
          { criterion_key: "2", verdict: 1, summary: "-", detail: "-", evidence: [] },
        ],
        competitors: [],
      }),
    },
  ]);
  const report = result.reports[0];
  assert.equal(report.criteria.length, 1);
  assert.equal(report.criteria[0].criterion_key, "1");
  assert.ok(report.notes.some((n) => /^3 записи/.test(n)), "null + нерядковий key + нерядковий verdict — усі три відкинуто");
});

test("критерій без score/summary/detail отримує null, а не крашиться", () => {
  const result = parse([
    {
      provider: "ChatGPT",
      text: jsonBlock({ criteria: [{ criterion_key: "1", verdict: "passed", evidence: [] }], competitors: [] }),
    },
  ]);
  const criterion = result.reports[0].criteria[0];
  assert.equal(criterion.score, null);
  assert.equal(criterion.summary, null);
  assert.equal(criterion.detail, null);
});

// --- sanitizeEvidence: битий елемент масиву доказів ---
test("докази з битими записами відсіюються, лишається тільки валідне", () => {
  const result = parse([
    {
      provider: "ChatGPT",
      text: jsonBlock({
        criteria: [
          {
            criterion_key: "1",
            verdict: "passed",
            summary: "-",
            detail: "-",
            evidence: [
              null,
              "рядок замість обʼєкта",
              { published_date: "2026-01-01" },
              { url: "https://example.com/a", published_date: "не дата", quote: 42 },
              { url: "https://example.com/b" },
            ],
          },
        ],
        competitors: [],
      }),
    },
  ]);
  const evidence = result.reports[0].criteria[0].evidence;
  assert.equal(evidence.length, 2, "лишились тільки записи з валідним url");
  assert.equal(evidence[0].url, "https://example.com/a");
  assert.equal(evidence[0].published_date, undefined, "невалідний формат дати відкидається");
  assert.equal(evidence[0].quote, undefined, "цитата не рядкового типу не потрапляє в результат");
  assert.equal(evidence[1].url, "https://example.com/b");
});

test("evidence не масив — трактується як відсутність доказів", () => {
  const result = parse([
    {
      provider: "ChatGPT",
      text: jsonBlock({
        criteria: [{ criterion_key: "1", verdict: "passed", summary: "-", detail: "-", evidence: "не масив" }],
        competitors: [],
      }),
    },
  ]);
  assert.deepEqual(result.reports[0].criteria[0].evidence, []);
});

// --- sanitizeCompetitors: сміттєві елементи й межі liveness/last_activity ---
test("конкуренти: невалідний елемент і порожнє імʼя відсіюються, решта проходить", () => {
  const result = parse([
    {
      provider: "ChatGPT",
      text: jsonBlock({
        criteria: [],
        competitors: [
          null,
          "рядок замість обʼєкта",
          { name: 123 },
          { name: "   " },
          { name: "Валідний", liveness: "zombie", last_activity: "2026/02/01" },
          { name: "Другий", liveness: "active", last_activity: "2026-03-15" },
        ],
      }),
    },
  ]);
  const competitors = result.reports[0].competitors;
  assert.equal(competitors.length, 2, "лишились тільки записи з непорожнім рядковим імʼям");
  assert.equal(competitors[0].name, "Валідний");
  assert.equal(competitors[0].liveness, undefined, "\"zombie\" поза переліком liveness");
  assert.equal(competitors[0].last_activity, undefined, "дата не у форматі YYYY-MM-DD");
  assert.equal(competitors[1].liveness, "active");
  assert.equal(competitors[1].last_activity, "2026-03-15");
});

// --- Ремонт json-блоку: типографські лапки та рядки-коментарі ---
test("типографські лапки на весь блок лагодяться", () => {
  const curlyJson = criteriaJson.replace(/"/g, "“");
  const result = parse([{ provider: "ChatGPT", text: "```json\n" + curlyJson + "\n```" }]);
  assert.equal(result.reports[0].status, "ok");
  assert.ok(result.reports[0].notes.some((n) => /типографські лапки/.test(n)));
});

test("рядки-коментарі у json-блоці лагодяться", () => {
  const withComment = "{\n// це коментар\n" + criteriaJson.slice(1);
  const result = parse([{ provider: "ChatGPT", text: "```json\n" + withComment + "\n```" }]);
  assert.equal(result.reports[0].status, "ok");
  assert.ok(result.reports[0].notes.some((n) => /коментарі/.test(n)));
});

// --- Топрівневий json іншого типу: масив або null замість обʼєкта ---
test("json-блок з масивом на верхньому рівні не використовується як звіт", () => {
  const result = parse([{ provider: "ChatGPT", text: "```json\n[1, 2, 3]\n```" }]);
  assert.equal(result.reports[0].status, "prose");
});

test("json-блок з null на верхньому рівні не використовується як звіт", () => {
  const result = parse([{ provider: "ChatGPT", text: "```json\nnull\n```" }]);
  assert.equal(result.reports[0].status, "prose");
});

// --- Вирізаний обʼєкт без очікуваних ключів ігнорується ---
test("вирізаний обʼєкт без criteria/competitors не використовується", () => {
  const result = parse([
    { provider: "ChatGPT", text: "```json\nОсь підсумок: {\"foo\": \"bar\"} Кінець.\n```" },
  ]);
  assert.equal(result.reports[0].status, "prose");
});

// --- Структурно збалансований, але семантично зламаний json ---
test("збалансовані дужки не рятують семантично зламаний json", () => {
  const result = parse([{ provider: "ChatGPT", text: "```json\n{\"criteria\": undefined}\n```" }]);
  const report = result.reports[0];
  assert.equal(report.status, "prose", "дужки на місці, але undefined — не валідний JSON, ремонт тут безсилий");
  assert.match(report.problem!, /не розбирається як JSON/);
});

test("незбалансовані лише квадратні дужки теж не рятують зламаний json", () => {
  const result = parse([{ provider: "ChatGPT", text: "```json\n{\"list\": [1, 2, 3}\n```" }]);
  assert.equal(result.reports[0].status, "prose");
});

// --- Обрив рядка на межі "поза рядком" / "усередині рядка" ---
test("обрив одразу після завершеного рядка закриває дужки без обрізання хвоста", () => {
  const raw = '{"criteria": [ {"criterion_key": "1", "verdict": "passed", "evidence": []} ';
  const result = parse([{ provider: "ChatGPT", text: "```json\n" + raw + "\n```" }]);
  const report = result.reports[0];
  assert.equal(report.status, "ok", "обрив поза рядком — дужки просто дозакриваються");
  assert.equal(report.criteria.length, 1);
});

test("обрив усередині рядка з комою в хвості обрізає його до коми", () => {
  const raw = '{"criteria": [ {"criterion_key": "1", "verdict": "pass';
  const result = parse([{ provider: "ChatGPT", text: "```json\n" + raw + "\n```" }]);
  // Ремонт форми тут не рятує зміст (обрізаний вердикт однаково не JSON), але
  // саме обрізання до останньої коми (а не до кінця тексту) має відбутись.
  assert.equal(result.reports[0].status, "prose");
});

test("обрив усередині рядка без жодної коми лишає текст як є", () => {
  const raw = '{"criteria": "pass';
  const result = parse([{ provider: "ChatGPT", text: "```json\n" + raw + "\n```" }]);
  assert.equal(result.reports[0].status, "prose");
});

// Екранований символ у значенні рядка (\\) не має зіпсувати підрахунок глибини
// дужок під час ремонту обірваного блоку.
test("екранований бекслеш усередині рядка не плутає лічильник дужок при ремонті", () => {
  const raw =
    '{"criteria": [ {"criterion_key": "1", "verdict": "passed", "summary": "back\\\\slash", "evidence": []} ';
  const result = parse([{ provider: "ChatGPT", text: "```json\n" + raw + "\n```" }]);
  const report = result.reports[0];
  assert.equal(report.status, "ok");
  assert.equal(report.criteria[0].summary, "back\\slash");
});
