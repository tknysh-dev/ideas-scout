import assert from "node:assert/strict";
import test from "node:test";
import { IDEA_ID_PATTERN } from "./idea-refs.ts";

// Патерн стейтфулний (global flag -> lastIndex), тож перед кожним
// самостійним використанням його скидаємо — так само, як роблять
// linkify.tsx і rehype-idea-refs.ts.
function matches(value: string): string[] {
  IDEA_ID_PATTERN.lastIndex = 0;
  return [...value.matchAll(IDEA_ID_PATTERN)].map((m) => m[0]);
}

test("типовий id (2 літери, 4 цифри) розпізнається", () => {
  assert.deepEqual(matches("Дивись PI-0011 для деталей."), ["PI-0011"]);
});

test("мінімальна довжина цифр (3) розпізнається", () => {
  assert.deepEqual(matches("APP-013"), ["APP-013"]);
});

test("максимальна довжина цифр (5) розпізнається", () => {
  assert.deepEqual(matches("APP-99999"), ["APP-99999"]);
});

test("менше 3 цифр — не збігається", () => {
  assert.deepEqual(matches("APP-01"), []);
});

test("більше 5 цифр — не збігається (жоден префікс довжини не підходить)", () => {
  assert.deepEqual(matches("APP-123456"), []);
});

test("мінімальна довжина префікса (2 літери) розпізнається", () => {
  assert.deepEqual(matches("PI-0001"), ["PI-0001"]);
});

test("максимальна довжина префікса (6 літер) розпізнається", () => {
  assert.deepEqual(matches("ABCDEF-0001"), ["ABCDEF-0001"]);
});

test("префікс з 1 літери — не збігається", () => {
  assert.deepEqual(matches("P-0001"), []);
});

test("префікс з 7 літер — не збігається (\\b не знаходить межі)", () => {
  assert.deepEqual(matches("ABCDEFG-0001"), []);
});

test("нижній регістр не розпізнається", () => {
  assert.deepEqual(matches("pi-0011"), []);
});

test("без дефіса між префіксом і числом — не збігається", () => {
  assert.deepEqual(matches("PI0011"), []);
});

test("кілька id в одному рядку розпізнаються всі", () => {
  assert.deepEqual(matches("PI-0001 і APP-0013 разом, ще ABCDE-99999."), [
    "PI-0001",
    "APP-0013",
    "ABCDE-99999",
  ]);
});

test("текст без id повертає порожній список", () => {
  assert.deepEqual(matches("Звичайний текст без ідентифікаторів."), []);
});

// \b перевіряє межу лише перед початком усього збігу — тому префікс, що
// приліплений до попереднього слова без пробілу, теж читається як
// повноцінний id: сам префікс стає початком слова, а не "PI" всередині.
test("літери, приліплені до попереднього слова без пробілу, все одно формують валідний id", () => {
  assert.deepEqual(matches("щосьXPI-0001"), ["XPI-0001"]);
});

// Патерн — модульний singleton із /g. Якщо не скинути lastIndex,
// exec() на новому рядку продовжує з позиції попереднього виклику й може
// пропустити збіг на початку рядка. Саме тому і лінкіфай, і rehype-плагін
// явно виставляють lastIndex = 0 перед кожним використанням.
test("без скидання lastIndex повторний exec() на новому рядку губить збіг (задокументована пастка)", () => {
  IDEA_ID_PATTERN.lastIndex = 0;
  IDEA_ID_PATTERN.exec("PI-0001 десь в кінці рядка PI-0002");
  assert.ok(IDEA_ID_PATTERN.lastIndex > 0);

  const secondCallWithoutReset = IDEA_ID_PATTERN.exec("APP-0013 новий рядок");
  assert.equal(secondCallWithoutReset, null);

  IDEA_ID_PATTERN.lastIndex = 0;
  const afterReset = IDEA_ID_PATTERN.exec("APP-0013 новий рядок");
  assert.equal(afterReset?.[0], "APP-0013");
});
