import assert from "node:assert/strict";
import test from "node:test";
import {
  OTHER_REASON_MAX,
  REJECTION_CODES,
  buildDecisionEventChange,
  buildDecisionEventRow,
  buildIdeaUpdatePayload,
  checkDecisionTransition,
  validateDecisionInput,
} from "./decisions-logic.ts";

// --- validateDecisionInput -------------------------------------------------

test("validateDecisionInput: відсутній ideaId відхиляється", () => {
  assert.equal(
    validateDecisionInput({ ideaId: "", action: "accepted", reason: "" }),
    "Не вказано ідею.",
  );
});

test("validateDecisionInput: невідома дія відхиляється", () => {
  assert.equal(
    validateDecisionInput({ ideaId: "PI-1", action: "postponed", reason: "" }),
    "Невідома дія.",
  );
});

test("validateDecisionInput: відхилення без причини відхиляється", () => {
  assert.equal(
    validateDecisionInput({ ideaId: "PI-1", action: "rejected", reason: "" }),
    "Для відхилення обов'язково вкажи причину.",
  );
});

test("validateDecisionInput: відхилення без коду відхиляється", () => {
  assert.equal(
    validateDecisionInput({ ideaId: "PI-1", action: "rejected", reason: "бо так" }),
    "Обери код відмови зі словника.",
  );
});

test("validateDecisionInput: відхилення з кодом поза словником відхиляється", () => {
  assert.equal(
    validateDecisionInput({
      ideaId: "PI-1",
      action: "rejected",
      reason: "бо так",
      rejectionCode: "MADE_UP",
    }),
    "Обери код відмови зі словника.",
  );
});

test("validateDecisionInput: відхилення з валідним кодом проходить", () => {
  assert.equal(
    validateDecisionInput({
      ideaId: "PI-1",
      action: "rejected",
      reason: "бо так",
      rejectionCode: "LEGAL",
    }),
    null,
  );
});

test("validateDecisionInput: прийняття без причини й коду проходить", () => {
  assert.equal(validateDecisionInput({ ideaId: "PI-1", action: "accepted", reason: "" }), null);
});

// NO_MARKET додано міграцією 2026-08-03 і його пише пайплайн, але список у
// порталі тоді не оновили — власник не міг відхилити ідею з цим кодом вручну.
// Тест стежить, щоб перелік дії не розходився зі схемою знову.
test("validateDecisionInput: NO_MARKET приймається — код зі схеми, не з пайплайну лише", () => {
  assert.equal(REJECTION_CODES.includes("NO_MARKET"), true);
  assert.equal(
    validateDecisionInput({
      ideaId: "PI-1",
      action: "rejected",
      reason: "ринку немає",
      rejectionCode: "NO_MARKET",
    }),
    null,
  );
});

test("validateDecisionInput: NOT_INTERESTED приймається без додаткових полів", () => {
  assert.equal(REJECTION_CODES.includes("NOT_INTERESTED"), true);
  assert.equal(
    validateDecisionInput({
      ideaId: "PI-1",
      action: "rejected",
      reason: "не мій напрямок",
      rejectionCode: "NOT_INTERESTED",
    }),
    null,
  );
});

test("validateDecisionInput: OTHER без вписаної причини відхиляється", () => {
  assert.equal(
    validateDecisionInput({
      ideaId: "PI-1",
      action: "rejected",
      reason: "бо так",
      rejectionCode: "OTHER",
      otherReason: "   ",
    }),
    "Для коду «Інше» впиши, що саме за причина.",
  );
});

test("validateDecisionInput: задовга причина для OTHER відхиляється", () => {
  const message = validateDecisionInput({
    ideaId: "PI-1",
    action: "rejected",
    reason: "бо так",
    rejectionCode: "OTHER",
    otherReason: "х".repeat(OTHER_REASON_MAX + 1),
  });
  assert.match(message ?? "", /не довша за/);
});

test("validateDecisionInput: OTHER із причиною проходить", () => {
  assert.equal(
    validateDecisionInput({
      ideaId: "PI-1",
      action: "rejected",
      reason: "бо так",
      rejectionCode: "OTHER",
      otherReason: "забагато ручної роботи",
    }),
    null,
  );
});

// --- checkDecisionTransition ------------------------------------------------

test("checkDecisionTransition: статус поза OWNER_DECIDABLE_STATUSES відхиляється", () => {
  const result = checkDecisionTransition("new", null, "accepted", "", undefined);
  assert.match(result.error ?? "", /веде аналітик/);
});

test("checkDecisionTransition: перше рішення (approved_pending) не вимагає причини", () => {
  const result = checkDecisionTransition("approved_pending", null, "accepted", "", undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.isRevision, false);
});

test("checkDecisionTransition: повторне прийняття вже прийнятої ідеї блокується", () => {
  // current !== "approved_pending" робить це переглядом, тож без причини впав
  // би раніше на перевірці isRevision — причину даємо, щоб дійти саме до
  // перевірки "той самий статус".
  const result = checkDecisionTransition("accepted", null, "accepted", "без змін", undefined);
  assert.match(result.error ?? "", /вже в статусі/);
});

test("checkDecisionTransition: повторне відхилення з тим самим кодом блокується", () => {
  const result = checkDecisionTransition("rejected", "LEGAL", "rejected", "знову", "LEGAL");
  assert.match(result.error ?? "", /вже в статусі/);
});

test("checkDecisionTransition: повторне відхилення з ІНШИМ кодом дозволяється (зміна коду)", () => {
  const result = checkDecisionTransition("rejected", "LEGAL", "rejected", "передумав", "CAPITAL");
  assert.equal(result.error, undefined);
  assert.equal(result.isRevision, true);
});

test("checkDecisionTransition: повторний OTHER із тією самою причиною блокується", () => {
  const result = checkDecisionTransition(
    "rejected", "OTHER", "rejected", "знову", "OTHER", "забагато ручної роботи", "забагато ручної роботи",
  );
  assert.match(result.error ?? "", /вже в статусі/);
});

// Під OTHER ховаються різні причини — правка самого тексту має проходити, хоч
// код відмови й не змінився.
test("checkDecisionTransition: повторний OTHER з ІНШОЮ причиною дозволяється", () => {
  const result = checkDecisionTransition(
    "rejected", "OTHER", "rejected", "уточнив", "OTHER", "забагато ручної роботи", "надто вузька ніша",
  );
  assert.equal(result.error, undefined);
  assert.equal(result.isRevision, true);
});

test("checkDecisionTransition: перегляд рішення (accepted -> rejected) без причини блокується", () => {
  const result = checkDecisionTransition("accepted", null, "rejected", "", "LEGAL");
  assert.match(result.error ?? "", /вимагає причини/);
});

test("checkDecisionTransition: перегляд рішення (rejected -> accepted) без причини блокується", () => {
  // Тут дія "accepted" сама по собі причини не вимагає (validateDecisionInput
  // це дозволяє) — заборону дає саме перевірка перегляду вже ухваленого рішення.
  const result = checkDecisionTransition("rejected", "LEGAL", "accepted", "", undefined);
  assert.match(result.error ?? "", /вимагає причини/);
});

test("checkDecisionTransition: перегляд рішення (rejected -> accepted) з причиною дозволяється", () => {
  const result = checkDecisionTransition("rejected", "LEGAL", "accepted", "передумав", undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.isRevision, true);
});

// --- buildIdeaUpdatePayload -------------------------------------------------

test("buildIdeaUpdatePayload: відхилення пише код і деталі", () => {
  const payload = buildIdeaUpdatePayload("rejected", "approved_pending", "LEGAL", "бо так");
  assert.deepEqual(payload, {
    status: "rejected",
    rejection_code: "LEGAL",
    rejection_detail: "бо так",
    rejection_other_reason: null,
  });
});

test("buildIdeaUpdatePayload: OTHER пише вписану причину окремо від деталей", () => {
  const payload = buildIdeaUpdatePayload(
    "rejected",
    "approved_pending",
    "OTHER",
    "довге пояснення в хронологію",
    "  забагато ручної роботи  ",
  );
  assert.deepEqual(payload, {
    status: "rejected",
    rejection_code: "OTHER",
    rejection_detail: "довге пояснення в хронологію",
    rejection_other_reason: "забагато ручної роботи",
  });
});

// Причина «Інше» описує рішення, якого вже немає: лишити її означало б показати
// «Ринок насичений (забагато ручної роботи)» після зміни коду.
test("buildIdeaUpdatePayload: зміна коду з OTHER на словниковий стирає вписану причину", () => {
  const payload = buildIdeaUpdatePayload("rejected", "rejected", "SATURATED", "передумав", "стара");
  assert.equal(payload.rejection_other_reason, null);
});

test("buildIdeaUpdatePayload: прийняття після відхилення очищує поля відмови", () => {
  const payload = buildIdeaUpdatePayload("accepted", "rejected", undefined, "передумав");
  assert.deepEqual(payload, {
    status: "accepted",
    rejection_code: null,
    rejection_detail: null,
    rejection_other_reason: null,
    rejection_codes_extra: [],
  });
});

test("buildIdeaUpdatePayload: перше прийняття не чіпає поля відмови", () => {
  const payload = buildIdeaUpdatePayload("accepted", "approved_pending", undefined, "");
  assert.deepEqual(payload, { status: "accepted" });
});

// --- buildDecisionEventChange / buildDecisionEventRow -----------------------

test("buildDecisionEventChange: перше прийняття", () => {
  assert.equal(
    buildDecisionEventChange("approved_pending", "accepted", undefined, false),
    "status: approved_pending -> accepted — власник прийняв ідею як годну",
  );
});

test("buildDecisionEventChange: відхилення додає код у дужках", () => {
  assert.equal(
    buildDecisionEventChange("approved_pending", "rejected", "LEGAL", false),
    "status: approved_pending -> rejected (LEGAL) — власник відхилив ідею",
  );
});

test("buildDecisionEventChange: OTHER несе вписану причину в тих самих дужках", () => {
  assert.equal(
    buildDecisionEventChange("approved_pending", "rejected", "OTHER", false, "надто вузька ніша"),
    "status: approved_pending -> rejected (OTHER: надто вузька ніша) — власник відхилив ідею",
  );
});

test("buildDecisionEventChange: перегляд рішення додає суфікс до мітки дії, а не в кінець рядка", () => {
  assert.equal(
    buildDecisionEventChange("rejected", "accepted", undefined, true),
    "status: rejected -> accepted — власник прийняв ідею як годну, переглянувши рішення",
  );
});

test("buildDecisionEventRow: порожня причина стає null", () => {
  const row = buildDecisionEventRow("PI-1", "approved_pending", "accepted", undefined, false, "");
  assert.equal(row.reason, null);
  assert.equal(row.idea_id, "PI-1");
  assert.equal(row.actor, "owner:dashboard");
});

test("buildDecisionEventRow: непорожня причина зберігається як є", () => {
  const row = buildDecisionEventRow("PI-1", "rejected", "accepted", undefined, true, "передумав");
  assert.equal(row.reason, "передумав");
});
