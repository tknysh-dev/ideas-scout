import assert from "node:assert/strict";
import test from "node:test";
import { createIdeaIdPattern } from "./idea-refs.ts";

// createIdeaIdPattern() повертає новий регекс на кожен виклик — не спільний
// стейтфулний singleton, тож ніякого lastIndex скидати не треба.
function matches(value: string): string[] {
  return [...value.matchAll(createIdeaIdPattern())].map((m) => m[0]);
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

// Раніше патерн був модульним singleton-ом із /g: exec() на одному рядку
// зсував lastIndex, і наступний виклик на НОВОМУ рядку без явного скидання
// губив збіг на початку. createIdeaIdPattern() віддає свіжий регекс щоразу,
// тож два незалежні виклики більше не діляться станом.
test("createIdeaIdPattern(): два незалежні виклики не діляться lastIndex", () => {
  const first = createIdeaIdPattern();
  first.exec("PI-0001 десь в кінці рядка PI-0002");
  assert.ok(first.lastIndex > 0);

  const second = createIdeaIdPattern();
  assert.equal(second.lastIndex, 0);
  assert.equal(second.exec("APP-0013 новий рядок")?.[0], "APP-0013");
});
