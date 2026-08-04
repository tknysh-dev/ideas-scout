import assert from "node:assert/strict";
import test from "node:test";
import { parseReportsBlob, sanitizeLabel } from "./deep-research-reports.ts";

const IDEA_ID = "PI-0013";
const TRACK = "passive-income";

function wrap(label: string, ideaId: string, body: string, model?: string) {
  const head = model ? `${label} | ${model}` : label;
  return [
    `===== DEEP RESEARCH REPORT START | ${head} | ${ideaId} =====`,
    body,
    "===== DEEP RESEARCH REPORT END =====",
  ].join("\n");
}

function jsonBlock(payload: unknown) {
  return "```json\n" + JSON.stringify(payload, null, 2) + "\n```";
}

const goodPayload = {
  researcher: "ChatGPT",
  self_reported_model: "GPT-5.4",
  criteria: [
    {
      criterion_key: "1",
      verdict: "passed",
      score: "B",
      summary: "Джерело витримує перевірку",
      detail: "Автор показав скріншоти виплат.",
      evidence: [{ url: "https://example.com/a", published_date: "2026-02-01", quote: "виплата" }],
    },
    {
      criterion_key: "d_demand",
      verdict: "noted",
      summary: "Попит є, але вузький",
      evidence: [],
    },
  ],
  competitors: [
    {
      name: "Notionery",
      url: "https://notionery.example",
      pricing: "$9/міс",
      liveness: "active",
      last_activity: "2026-05-02",
      evidence: [{ url: "https://notionery.example/changelog", published_date: "2026-05-02" }],
    },
  ],
};

function parse(blob: string) {
  return parseReportsBlob({ ideaId: IDEA_ID, track: TRACK, blob });
}

test("кілька звітів в одному блобі розбираються окремо", () => {
  const blob = [
    "Тут випадковий текст, який власник скопіював разом зі звітами.",
    wrap("ChatGPT", IDEA_ID, `Прозовий звіт.\n\n${jsonBlock(goodPayload)}`),
    "",
    wrap("Perplexity", IDEA_ID, `Інший звіт.\n\n${jsonBlock({ ...goodPayload, researcher: "Perplexity" })}`),
  ].join("\n");

  const result = parse(blob);
  assert.equal(result.error, undefined);
  assert.equal(result.reports.length, 2);
  assert.equal(result.validCount, 2);
  assert.deepEqual(result.reports.map((r) => r.label), ["ChatGPT", "Perplexity"]);
  assert.equal(result.reports[0].criteria.length, 2);
  assert.equal(result.reports[0].competitors.length, 1);
  assert.equal(result.reports[0].model, "GPT-5.4");
  // Вербатим-текст лишається без маркерів, але з json-блоком: саме його читає
  // синтез на M1.
  assert.match(result.reports[0].reportMd, /Прозовий звіт/);
  assert.doesNotMatch(result.reports[0].reportMd, /REPORT START/);
  assert.match(result.reports[0].reportMd, /```json/);
});

test("текст без маркерів не дає жодного звіту і пояснює, чого бракує", () => {
  const result = parse(`Звіт без обгортки.\n\n${jsonBlock(goodPayload)}`);
  assert.equal(result.reports.length, 0);
  assert.equal(result.validCount, 0);
  assert.match(result.error ?? "", /DEEP RESEARCH REPORT START/);
});

test("порожнє поле — окреме повідомлення, не «немає маркерів»", () => {
  const result = parse("   \n  ");
  assert.match(result.error ?? "", /Поле порожнє/);
});

test("звіт про іншу ідею відхиляється з поясненням", () => {
  const blob = wrap("Gemini", "AP-0042", `Звіт.\n\n${jsonBlock(goodPayload)}`);
  const result = parse(blob);
  assert.equal(result.reports.length, 1);
  assert.equal(result.validCount, 0);
  assert.equal(result.reports[0].status, "foreign");
  assert.match(result.reports[0].problem ?? "", /AP-0042/);
  assert.match(result.reports[0].problem ?? "", /PI-0013/);
});

test("SEARCH UNAVAILABLE — відмова моделі, а не помилка розбору", () => {
  const result = parse(wrap("Gemini", IDEA_ID, "SEARCH UNAVAILABLE"));
  assert.equal(result.reports[0].status, "refused");
  assert.equal(result.validCount, 0);
  assert.match(result.reports[0].problem ?? "", /живого веб-пошуку/);
});

test("невалідний json відрізняється від повної відсутності json-блока", () => {
  const broken = parse(wrap("Grok", IDEA_ID, "Звіт.\n\n```json\n{\"criteria\": [\n```"));
  assert.equal(broken.reports[0].status, "invalid");
  assert.match(broken.reports[0].problem ?? "", /не розбирається як JSON/);

  const missing = parse(wrap("Grok", IDEA_ID, "Просто проза без підсумку."));
  assert.equal(missing.reports[0].status, "invalid");
  assert.match(missing.reports[0].problem ?? "", /немає машиночитного блоку/);
});

test("береться останній валідний json-блок, а не перший", () => {
  const body = [
    "Чернетка:",
    jsonBlock({ criteria: [{ criterion_key: "0", verdict: "failed" }] }),
    "Фінальний підсумок:",
    jsonBlock(goodPayload),
  ].join("\n\n");
  const result = parse(wrap("ChatGPT", IDEA_ID, body));
  assert.deepEqual(
    result.reports[0].criteria.map((c) => c.criterion_key),
    ["1", "d_demand"],
  );
});

test("критерії поза білим списком і невідомі вердикти відкидаються", () => {
  const payload = {
    researcher: "ChatGPT",
    criteria: [
      { criterion_key: "1", verdict: "passed", summary: "ок" },
      { criterion_key: "99", verdict: "passed", summary: "критерію 99 не існує" },
      { criterion_key: "d_vibes", verdict: "passed", summary: "вигаданий блок" },
      { criterion_key: "2", verdict: "totally_fine", summary: "вигаданий вердикт" },
      { criterion_key: "7", verdict: "passed", summary: "критерій чужого треку" },
      "не об'єкт",
    ],
    competitors: [],
  };
  const result = parse(wrap("ChatGPT", IDEA_ID, jsonBlock(payload)));
  const report = result.reports[0];
  assert.equal(report.status, "ok");
  assert.deepEqual(report.criteria.map((c) => c.criterion_key), ["1"]);
  assert.ok(report.notes.some((note) => /^5 записів у json-блоці відкинуто/.test(note)));
});

test("json без жодного відомого критерію й конкурента — звіт непридатний", () => {
  const result = parse(
    wrap("ChatGPT", IDEA_ID, jsonBlock({ criteria: [{ key: "1", ok: true }], competitors: [] })),
  );
  assert.equal(result.reports[0].status, "invalid");
  assert.match(result.reports[0].problem ?? "", /жодного критерію з відомим ключем/);
});

test("дубль мітки не губить другий звіт, а розводить їх суфіксом", () => {
  const blob = [
    wrap("ChatGPT", IDEA_ID, jsonBlock(goodPayload)),
    wrap("ChatGPT", IDEA_ID, jsonBlock(goodPayload)),
  ].join("\n");
  const result = parse(blob);
  assert.deepEqual(result.reports.map((r) => r.label), ["ChatGPT", "ChatGPT (2)"]);
  assert.equal(result.validCount, 2);
  assert.ok(result.reports[1].notes.some((note) => /вже зайнята/.test(note)));
});

test("незаповнений плейсхолдер мітки замінюється значенням з json", () => {
  const blob = wrap("{{RESEARCHER_LABEL}}", IDEA_ID, jsonBlock(goodPayload));
  assert.equal(parse(blob).reports[0].label, "ChatGPT");

  const noResearcher = wrap(
    "",
    IDEA_ID,
    jsonBlock({ ...goodPayload, researcher: undefined, self_reported_model: "Claude Opus 5" }),
  );
  assert.equal(parse(noResearcher).reports[0].label, "Claude Opus 5");

  const nothing = wrap("", IDEA_ID, "SEARCH UNAVAILABLE");
  assert.equal(parse(nothing).reports[0].label, "unknown-1");
});

test("звіт без закривального маркера все одно читається, але з зауваженням", () => {
  const blob = [
    `===== DEEP RESEARCH REPORT START | ChatGPT | ${IDEA_ID} =====`,
    "Звіт без кінцевого маркера.",
    jsonBlock(goodPayload),
    "",
    wrap("Gemini", IDEA_ID, jsonBlock(goodPayload)),
  ].join("\n");
  const result = parse(blob);
  assert.deepEqual(result.reports.map((r) => r.label), ["ChatGPT", "Gemini"]);
  assert.ok(result.reports[0].notes.some((note) => /закривальний рядок/.test(note)));
  assert.doesNotMatch(result.reports[0].reportMd, /Gemini/);
});

test("санітизація обрізає довжини й керівні символи", () => {
  assert.equal(sanitizeLabel("Chat GPT​  Deep\nResearch"), "Chat GPT Deep Research");
  assert.equal(sanitizeLabel("x".repeat(300)).length, 100);
  assert.equal(sanitizeLabel(42), "");

  const payload = {
    researcher: "ChatGPT",
    criteria: [
      {
        criterion_key: "1",
        verdict: "passed",
        score: "S".repeat(200),
        summary: "s".repeat(900),
        detail: "d".repeat(9000),
        evidence: [
          { url: "https://ok.example", published_date: "01.02.2026" },
          { published_date: "2026-02-01" },
        ],
      },
    ],
    competitors: [
      { name: "  Живий  ", liveness: "мертвий", last_activity: "торік" },
      { name: "", liveness: "dead" },
    ],
  };
  const report = parse(wrap("ChatGPT", IDEA_ID, jsonBlock(payload))).reports[0];
  const criterion = report.criteria[0];
  assert.equal(criterion.score?.length, 100);
  assert.equal(criterion.summary?.length, 500);
  assert.equal(criterion.detail?.length, 5000);
  // Доказ без url не існує, а дата не формату YYYY-MM-DD не зберігається.
  assert.deepEqual(criterion.evidence, [{ url: "https://ok.example" }]);
  assert.equal(report.competitors.length, 1);
  assert.equal(report.competitors[0].name, "Живий");
  assert.equal(report.competitors[0].liveness, undefined);
  assert.equal(report.competitors[0].last_activity, undefined);
});

test("трек без чек-листа критеріїв не розбирається взагалі", () => {
  const result = parseReportsBlob({
    ideaId: IDEA_ID,
    track: "crypto",
    blob: wrap("ChatGPT", IDEA_ID, jsonBlock(goodPayload)),
  });
  assert.equal(result.reports.length, 0);
  assert.match(result.error ?? "", /чек-листа критеріїв/);
});

test("модель із маркера потрапляє в розбір окремо від сервісу", () => {
  const blob = wrap("ChatGPT", IDEA_ID, `Звіт.\n\n${jsonBlock(goodPayload)}`, "GPT-5.2 Thinking");
  const report = parse(blob).reports[0];
  assert.equal(report.label, "ChatGPT", "вкладки групуються за сервісом, тому мітка лишається чистою");
  assert.equal(report.model, "GPT-5.2 Thinking");
});

test("модель із маркера важливіша за самоназву моделі у звіті", () => {
  // Власник знає, у якому вікні працював; модель часто не знає власної версії.
  const blob = wrap(
    "ChatGPT",
    IDEA_ID,
    `Звіт.\n\n${jsonBlock({ ...goodPayload, self_reported_model: "GPT-4" })}`,
    "GPT-5.2 Thinking",
  );
  assert.equal(parse(blob).reports[0].model, "GPT-5.2 Thinking");
});

test("незаповнений плейсхолдер моделі не вважається назвою моделі", () => {
  const blob = wrap(
    "ChatGPT",
    IDEA_ID,
    `Звіт.\n\n${jsonBlock({ ...goodPayload, self_reported_model: null })}`,
    "{{RESEARCHER_MODEL}}",
  );
  assert.equal(parse(blob).reports[0].model, null);
});

test("маркер без моделі і далі читається — промпт до цієї зміни не ламається", () => {
  const blob = wrap("Gemini", IDEA_ID, `Звіт.\n\n${jsonBlock(goodPayload)}`);
  const report = parse(blob).reports[0];
  assert.equal(report.label, "Gemini");
  assert.equal(report.model, "GPT-5.4", "падає назад на самоназву моделі зі звіту");
});
