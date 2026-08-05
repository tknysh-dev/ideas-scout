import assert from "node:assert/strict";
import test from "node:test";
import {
  NUDGE_DELAY_MS,
  buildJobs,
  chatIdOf,
  hasValidSecret,
  isTelegramUpdate,
  needsNudge,
} from "./telegram-webhook.ts";

test("hasValidSecret: правильний секрет приймається", () => {
  assert.equal(hasValidSecret("s3cr3t", "s3cr3t"), true);
});

test("hasValidSecret: невірний секрет тієї ж довжини відхиляється", () => {
  assert.equal(hasValidSecret("s3cr3T", "s3cr3t"), false);
});

test("hasValidSecret: відсутній заголовок (null) відхиляється", () => {
  assert.equal(hasValidSecret(null, "s3cr3t"), false);
});

test("hasValidSecret: порожній рядок відхиляється", () => {
  assert.equal(hasValidSecret("", "s3cr3t"), false);
});

test("hasValidSecret: секрет іншої довжини не кидає виняток, а повертає false", () => {
  // timingSafeEqual кидає RangeError на буферах різної довжини — функція
  // мусить перехопити це порівнянням довжин ДО виклику, інакше 500 замість 401.
  assert.doesNotThrow(() => hasValidSecret("short", "much-longer-secret"));
  assert.equal(hasValidSecret("short", "much-longer-secret"), false);
  assert.doesNotThrow(() => hasValidSecret("much-longer-secret", "short"));
  assert.equal(hasValidSecret("much-longer-secret", "short"), false);
});

test("hasValidSecret: префікс правильного секрету відхиляється", () => {
  assert.equal(hasValidSecret("s3cr3", "s3cr3t"), false);
});

test("isTelegramUpdate: валідний апдейт приймається", () => {
  assert.equal(isTelegramUpdate({ update_id: 42 }), true);
});

test("isTelegramUpdate: не-об'єкти відхиляються", () => {
  assert.equal(isTelegramUpdate("42"), false);
  assert.equal(isTelegramUpdate(42), false);
  assert.equal(isTelegramUpdate(null), false);
  assert.equal(isTelegramUpdate([{ update_id: 1 }]), false);
});

test("isTelegramUpdate: без update_id відхиляється", () => {
  assert.equal(isTelegramUpdate({}), false);
});

test("isTelegramUpdate: update_id не ціле число відхиляється", () => {
  assert.equal(isTelegramUpdate({ update_id: "42" }), false);
  assert.equal(isTelegramUpdate({ update_id: 4.2 }), false);
  assert.equal(isTelegramUpdate({ update_id: NaN }), false);
  assert.equal(isTelegramUpdate({ update_id: Infinity }), false);
});

test("isTelegramUpdate: update_id як true відхиляється (Number.isSafeInteger(true) === false)", () => {
  assert.equal(isTelegramUpdate({ update_id: true }), false);
});

test("chatIdOf: чат з message.chat.id як число", () => {
  assert.equal(chatIdOf({ message: { chat: { id: 123 } } }), "123");
});

test("chatIdOf: чат з edited_message.chat.id як рядок", () => {
  assert.equal(chatIdOf({ edited_message: { chat: { id: "456" } } }), "456");
});

test("chatIdOf: чат з callback_query.message.chat.id", () => {
  assert.equal(chatIdOf({ callback_query: { message: { chat: { id: 789 } } } }), "789");
});

test("chatIdOf: пріоритет message над edited_message і callback_query", () => {
  assert.equal(
    chatIdOf({
      message: { chat: { id: 1 } },
      edited_message: { chat: { id: 2 } },
      callback_query: { message: { chat: { id: 3 } } },
    }),
    "1",
  );
});

test("chatIdOf: відсутній чат повертає null", () => {
  assert.equal(chatIdOf({}), null);
});

test("chatIdOf: порожній об'єкт повертає null", () => {
  assert.equal(chatIdOf({}), null);
});

test("chatIdOf: контейнер не об'єкт повертає null", () => {
  assert.equal(chatIdOf({ message: "not-an-object" }), null);
});

test("chatIdOf: chat не об'єкт повертає null", () => {
  assert.equal(chatIdOf({ message: { chat: "not-an-object" } }), null);
});

test("chatIdOf: chat.id не число і не рядок повертає null", () => {
  assert.equal(chatIdOf({ message: { chat: { id: {} } } }), null);
  assert.equal(chatIdOf({ message: { chat: { id: null } } }), null);
});

test("needsNudge: звичайний текст потребує нуджу", () => {
  assert.equal(needsNudge({ message: { text: "привіт" } }), true);
});

test("needsNudge: команда не потребує нуджу", () => {
  assert.equal(needsNudge({ message: { text: "/start" } }), false);
});

test("needsNudge: команда з провідними пробілами не потребує нуджу", () => {
  assert.equal(needsNudge({ message: { text: "   /start" } }), false);
});

test("needsNudge: повідомлення без тексту (напр. фото) потребує нуджу", () => {
  assert.equal(needsNudge({ message: { photo: [{ file_id: "x" }] } }), true);
});

test("needsNudge: відсутній message не потребує нуджу", () => {
  assert.equal(needsNudge({}), false);
});

test("buildJobs: звичайне повідомлення дає 2 job'и з правильними ключами й зсувом часу", () => {
  const update = { update_id: 100, message: { text: "привіт" } };
  const receivedAt = Date.parse("2026-08-05T10:00:00.000Z");
  const jobs = buildJobs(update, receivedAt);

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].type, "telegram_update");
  assert.equal(jobs[0].idempotency_key, "telegram-update:100");
  assert.equal(jobs[0].available_at, new Date(receivedAt).toISOString());

  assert.equal(jobs[1].type, "telegram_nudge");
  assert.equal(jobs[1].idempotency_key, "telegram-nudge:100");
  assert.equal(jobs[1].available_at, new Date(receivedAt + NUDGE_DELAY_MS).toISOString());
});

test("buildJobs: команда дає лише 1 job (без нуджу)", () => {
  const update = { update_id: 101, message: { text: "/start" } };
  const jobs = buildJobs(update, Date.now());

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].type, "telegram_update");
});

test("buildJobs: усі job'и мають ідентичний набір ключів", () => {
  // Якщо ключі відрізняються (напр. nudge без available_at), PostgREST у
  // batch insert трактує відсутнє поле як NULL, а jobs.available_at має
  // NOT NULL constraint — вставка впаде на звичайних повідомленнях.
  const update = { update_id: 102, message: { text: "привіт" } };
  const jobs = buildJobs(update, Date.now());

  assert.equal(jobs.length, 2);
  const keysOf = (job: (typeof jobs)[number]) => Object.keys(job).sort();
  assert.deepEqual(keysOf(jobs[0]), keysOf(jobs[1]));
});
