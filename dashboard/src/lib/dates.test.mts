import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, formatDateTime } from "./dates.ts";

test("formatDate форматує ISO-дату у форматі uk-UA (короткий місяць)", () => {
  assert.equal(formatDate("2026-01-15T12:00:00Z"), "15 січ. 2026 р.");
});

test("formatDate підтримує long-стиль місяця", () => {
  assert.equal(formatDate("2026-01-15T12:00:00Z", "long"), "15 січня 2026 р.");
});

test("formatDate: null повертає дефолтний фолбек «—»", () => {
  assert.equal(formatDate(null), "—");
});

test("formatDate: порожній рядок теж трактується як відсутнє значення", () => {
  assert.equal(formatDate(""), "—");
});

test("formatDate: кастомний фолбек підставляється замість «—»", () => {
  assert.equal(formatDate(null, "short", "немає даних"), "немає даних");
});

test("formatDate: невалідний рядок дати не кидає виняток, повертає 'Invalid Date'", () => {
  assert.equal(formatDate("не-дата"), "Invalid Date");
});

test("formatDate: часовий пояс Europe/Warsaw зсуває дату біля півночі UTC (зимовий час, UTC+1)", () => {
  // 2026-01-01T23:30:00Z у Варшаві (UTC+1 узимку) — це вже 2 січня.
  assert.equal(formatDate("2026-01-01T23:30:00Z"), "2 січ. 2026 р.");
});

test("formatDate: часовий пояс зсуває дату влітку інакше (літній час, UTC+2)", () => {
  // 2026-06-15T22:30:00Z у Варшаві (UTC+2 влітку) — вже 16 червня.
  assert.equal(formatDate("2026-06-15T22:30:00Z"), "16 черв. 2026 р.");
});

test("formatDateTime додає години й хвилини за тим самим поясом", () => {
  assert.equal(formatDateTime("2026-01-15T22:30:00Z"), "15 січ. 2026 р., 23:30");
});

test("formatDateTime: null і невалідний вхід поводяться як formatDate", () => {
  assert.equal(formatDateTime(null), "—");
  assert.equal(formatDateTime(null, "short", "н/д"), "н/д");
  assert.equal(formatDateTime("гілбіш"), "Invalid Date");
});
