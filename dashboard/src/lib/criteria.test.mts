import assert from "node:assert/strict";
import test from "node:test";
import { analyzeCriteria, splitCriteriaSection, splitSection } from "./criteria.ts";
import type { CriteriaIdeaInput } from "./criteria.ts";

const idea: CriteriaIdeaInput = {
  track: "passive-income",
  type: "niche",
  signal_type: "income_claim",
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

test("порожній summary синтезу для критерія, якого проза не згадала, дає порожній вердикт", () => {
  const { section } = splitCriteriaSection(body);
  const structured = new Map([["5", { tone: "passed" as const, summary: null }]]);
  const result = analyzeCriteria(idea, section, structured)!;
  const c5 = result.results.find((r) => r.spec.n === 5)!;
  assert.equal(c5.structured, true);
  // на відміну від критерія з прозою, тут фолбеку немає — просто порожній рядок
  assert.equal(c5.verdict, "");
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

test("порожнє тіло картки (null) не шукає заголовок", () => {
  const result = splitSection(null, "Х");
  assert.deepEqual(result, { section: null, rest: "" });
});

test("розділ без наступного заголовка тягнеться до кінця тіла", () => {
  const card = ["## Механіка", "", "опис", "", "## Конкуренти", "", "Notevision — живий."].join(
    "\n",
  );
  const { section, rest } = splitSection(card, "Конкуренти");
  assert.match(section!, /Notevision/);
  assert.doesNotMatch(rest, /Notevision/);
});

test("критичний провал зупиняє чек-лист — наступний фатальний критерій позначено як не оцінений", () => {
  const section = "**1. Довіра до джерела — провал: пряма заборона регулятора. Не пройдено.**";
  const result = analyzeCriteria(idea, section)!;
  const c1 = result.results.find((r) => r.spec.n === 1)!;
  assert.equal(c1.tone, "failed");
  const c2 = result.results.find((r) => r.spec.n === 2)!;
  assert.match(c2.verdict, /зупинився на фатальному провалі критерія 1/);
});

test("абзац без номера критерія («Підсумок») йде в notes, а не в results", () => {
  const section = "**Підсумок.** Загальний висновок аналітика.";
  const result = analyzeCriteria(idea, section)!;
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].title, "Підсумок");
  assert.equal(result.notes[0].summary, true);
  // нічого не розібрано з прози — увесь чек-лист падає на фолбек "не згаданий"
  const c1 = result.results.find((r) => r.spec.n === 1)!;
  assert.match(c1.verdict, /у розборі не згаданий/);
});

test("тони «не оцінено» і «рішення власника» розпізнаються з прози", () => {
  const section = [
    "**3. Реалізовність — не оцінюється, делеговано нішам-дітям.** Механіка мультиплікується без змін.",
    "**4. Автономність — рішення власника: потрібна ручна перевірка юридичних обмежень.** Дивись коментар.",
  ].join("\n\n");
  const result = analyzeCriteria(idea, section)!;
  const c3 = result.results.find((r) => r.spec.n === 3)!;
  assert.equal(c3.tone, "skipped");
  const c4 = result.results.find((r) => r.spec.n === 4)!;
  assert.equal(c4.tone, "owner");
});

test("тон за замовчуванням — noted, коли жодне ключове слово не знайдено", () => {
  const section = "**5. Насиченість ринку — цікавий випадок.** Ринок непередбачуваний.";
  const result = analyzeCriteria(idea, section)!;
  const c5 = result.results.find((r) => r.spec.n === 5)!;
  assert.equal(c5.tone, "noted");
});

test("діапазон критеріїв «3–5» ділить один абзац на кілька результатів", () => {
  const section =
    "**3–5.** Ці критерії не оцінюються на рівні механіки. Рішення переноситься в ніші, що успадкували її.";
  const result = analyzeCriteria(idea, section)!;
  const c3 = result.results.find((r) => r.spec.n === 3)!;
  const c4 = result.results.find((r) => r.spec.n === 4)!;
  assert.deepEqual(c3.sharedWith, [3, 4, 5]);
  assert.deepEqual(c4.sharedWith, [3, 4, 5]);
  assert.ok(c3.body.length > 0, "перший критерій групи показує текст абзацу");
  assert.equal(c4.body, "", "решта групи не дублює той самий текст");
});

test("абзац-продовження без зірочок дописується до попереднього критерію; порожні блоки ігноруються", () => {
  // Два переведення рядка на початку рядка навмисно створюють порожній блок після split —
  // перевіряємо, що він мовчки пропускається, а не перетворюється на нотатку.
  const section =
    "\n\n**1. Довіра до джерела — пройдено.** Перше речення.\n\nДругий абзац без зірочок — уточнення без номера.";
  const result = analyzeCriteria(idea, section)!;
  assert.equal(result.notes.length, 0);
  const c1 = result.results.find((r) => r.spec.n === 1)!;
  assert.equal(c1.body, "Перше речення.\n\nДругий абзац без зірочок — уточнення без номера.");
});

test("вступний абзац без зірочок на самому початку йде в notes без назви", () => {
  const section =
    "Вільний вступний текст без жирного заголовка.\n\n**1. Довіра до джерела — пройдено.**";
  const result = analyzeCriteria(idea, section)!;
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].title, "Зауваження");
  assert.match(result.notes[0].body, /Вільний вступний текст/);
});

test("невідомий трек не має чек-листа критеріїв", () => {
  const result = analyzeCriteria(
    { track: "unknown-track", type: "niche", signal_type: "income_claim" },
    "будь-що",
  );
  assert.equal(result, null);
});

test("відсутня секція (null) не ламає розбір — увесь чек-лист іде у фолбек", () => {
  const result = analyzeCriteria(idea, null)!;
  assert.equal(result.notes.length, 0);
  const c1 = result.results.find((r) => r.spec.n === 1)!;
  assert.match(c1.verdict, /у розборі не згаданий/);
});

test("вердикт без тире в жирному зачині береться з першого речення абзацу", () => {
  const section = "**3.** Це перше речення стає вердиктом. Це друге речення лишається тілом.";
  const result = analyzeCriteria(idea, section)!;
  const c3 = result.results.find((r) => r.spec.n === 3)!;
  assert.equal(c3.verdict, "Це перше речення стає вердиктом.");
  assert.equal(c3.body, "Це друге речення лишається тілом.");
});

test("абзац без розділового знака в кінці лишає вердикт порожнім", () => {
  const section = "**4.** Текст без крапки в кінці абзацу";
  const result = analyzeCriteria(idea, section)!;
  const c4 = result.results.find((r) => r.spec.n === 4)!;
  assert.equal(c4.verdict, "");
  assert.equal(c4.body, "Текст без крапки в кінці абзацу");
});

test("для механіки: критерій, делегований нішам, і фатальний критерій без делегування дають різні фолбеки", () => {
  const mechanicIdea: CriteriaIdeaInput = {
    track: "passive-income",
    type: "mechanic",
    signal_type: "income_claim",
  };
  const section = "**1. Довіра до джерела — пройдено.** Автор перевірений.";
  const result = analyzeCriteria(mechanicIdea, section)!;
  const c3 = result.results.find((r) => r.spec.n === 3)!; // delegatedByMechanic: true
  assert.match(c3.verdict, /на рівні механіки не оцінюється/);
  const c2 = result.results.find((r) => r.spec.n === 2)!; // фатальний, але не делегований
  assert.match(c2.verdict, /не оцінювався: чек-лист зупинився раніше/);
});

test("критерій 0 застосовується лише для automation_report — фолбек залежить від типу сигналу", () => {
  const claimResult = analyzeCriteria(idea, "")!;
  const c0claim = claimResult.results.find((r) => r.spec.n === 0)!;
  assert.match(c0claim.verdict, /не застосовується: критерій лише для звітів про автоматизацію/);

  const reportIdea: CriteriaIdeaInput = { ...idea, signal_type: "automation_report" };
  const reportResult = analyzeCriteria(reportIdea, "")!;
  const c0report = reportResult.results.find((r) => r.spec.n === 0)!;
  // збіг сигналу знімає обмеження onlyForSignal — критерій 0 просто не згаданий у (порожній) прозі
  assert.match(c0report.verdict, /у розборі не згаданий/);
});
