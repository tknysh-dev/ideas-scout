import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHOR_INTEREST_META,
  CONFIDENCE_META,
  IDEA_TYPE_META,
  OWNER_DECIDABLE_STATUSES,
  REJECTION_META,
  SIGNAL_TYPE_META,
  STATUS_META,
  ideaTypeMeta,
  rejectionLabel,
  statusMeta,
  trackLabel,
} from "./status.ts";
import type { IdeaStatus } from "./types.ts";

test("statusMeta повертає точну метадані для кожного відомого статусу", () => {
  for (const status of Object.keys(STATUS_META) as IdeaStatus[]) {
    assert.deepEqual(statusMeta(status), STATUS_META[status]);
  }
});

test("statusMeta для невідомого статусу — фолбек із самим статусом як label", () => {
  const result = statusMeta("some_future_status" as IdeaStatus);
  assert.deepEqual(result, {
    label: "some_future_status",
    hint: "Статус поза словником shared/contracts.md",
    tone: "analyzing",
  });
});

test("statusMeta для порожнього рядка — той самий фолбек, без падіння", () => {
  const result = statusMeta("" as IdeaStatus);
  assert.deepEqual(result, {
    label: "",
    hint: "Статус поза словником shared/contracts.md",
    tone: "analyzing",
  });
});

test("OWNER_DECIDABLE_STATUSES — рівно три статуси рішення власника", () => {
  assert.deepEqual(
    [...OWNER_DECIDABLE_STATUSES].sort(),
    ["accepted", "approved_pending", "rejected"].sort(),
  );
  // new/analyzing належать аналітику, transferred — технічний стан.
  assert.ok(!OWNER_DECIDABLE_STATUSES.includes("new"));
  assert.ok(!OWNER_DECIDABLE_STATUSES.includes("analyzing"));
  assert.ok(!OWNER_DECIDABLE_STATUSES.includes("transferred"));
});

test("REJECTION_META містить підпис для кожного коду відмови", () => {
  for (const code of [
    "NO_MONETIZATION",
    "SOURCE_SUSPECT",
    "LEGAL",
    "CAPABILITY_GAP",
    "CAPITAL",
    "AUTONOMY",
    "SATURATED",
    "NO_MARKET",
    "NOT_INTERESTED",
    "OTHER",
  ] as const) {
    assert.equal(typeof REJECTION_META[code], "string");
    assert.ok(REJECTION_META[code].length > 0);
  }
});

test("rejectionLabel: словниковий код — просто його підпис", () => {
  assert.equal(rejectionLabel("LEGAL"), "Юридична заборона");
  assert.equal(rejectionLabel("NOT_INTERESTED"), "Нецікавий напрямок");
});

// Без цього «Інше» в таблиці стоїть без жодної підказки, чим саме воно було.
test("rejectionLabel: OTHER несе вписану причину в дужках", () => {
  assert.equal(rejectionLabel("OTHER", "надто вузька ніша"), "Інше (надто вузька ніша)");
});

test("rejectionLabel: OTHER без причини лишається просто «Інше»", () => {
  assert.equal(rejectionLabel("OTHER", "   "), "Інше");
  assert.equal(rejectionLabel("OTHER", null), "Інше");
});

test("rejectionLabel: причина без коду OTHER ігнорується", () => {
  assert.equal(rejectionLabel("SATURATED", "щось лишилось"), "Ринок насичений");
  assert.equal(rejectionLabel(null, "щось лишилось"), "");
});

test("CONFIDENCE_META і SIGNAL_TYPE_META накривають усі відомі значення", () => {
  for (const level of ["high", "medium", "low"] as const) {
    assert.equal(typeof CONFIDENCE_META[level].label, "string");
    assert.equal(typeof CONFIDENCE_META[level].tone, "string");
  }
  for (const type of ["income_claim", "automation_report"] as const) {
    assert.equal(typeof SIGNAL_TYPE_META[type], "string");
  }
});

test("AUTHOR_INTEREST_META накриває усі відомі значення", () => {
  for (const interest of ["none", "affiliate", "course_seller", "tool_vendor"] as const) {
    assert.equal(typeof AUTHOR_INTEREST_META[interest], "string");
  }
});

test("trackLabel повертає людську назву відомого треку", () => {
  assert.equal(trackLabel("passive-income"), "Пасивний дохід");
  assert.equal(trackLabel("app-ideas"), "Мобільні застосунки");
});

test("trackLabel для невідомого й порожнього треку повертає сам вхід як є", () => {
  assert.equal(trackLabel("unknown-track"), "unknown-track");
  assert.equal(trackLabel(""), "");
});

test("ideaTypeMeta повертає мітку й підказку для mechanic/niche", () => {
  assert.deepEqual(ideaTypeMeta("mechanic"), IDEA_TYPE_META.mechanic);
  assert.deepEqual(ideaTypeMeta("niche"), IDEA_TYPE_META.niche);
});

test("ideaTypeMeta для невідомого й порожнього типу — фолбек із типом як label", () => {
  assert.deepEqual(ideaTypeMeta("mystery"), {
    label: "mystery",
    hint: "Тип поза словником shared/contracts.md",
  });
  assert.deepEqual(ideaTypeMeta(""), {
    label: "",
    hint: "Тип поза словником shared/contracts.md",
  });
});
