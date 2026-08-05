import assert from "node:assert/strict";
import test from "node:test";
import {
  groupByProvider,
  groupVerdicts,
  parseEvidence,
} from "./deep-research.ts";
import type { CriteriaVerdictRow } from "./types.ts";

function verdictRow(overrides: Partial<CriteriaVerdictRow> & Pick<CriteriaVerdictRow, "criterion_key" | "kind" | "provider" | "verdict">): CriteriaVerdictRow {
  return {
    id: `${overrides.provider}-${overrides.criterion_key}`,
    idea_id: "PI-0001",
    run_id: null,
    stage: "deep",
    model: null,
    score: null,
    summary: null,
    detail: null,
    evidence: null,
    resolution: null,
    criteria_version: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("parseEvidence: розбирає масив валідних записів з усіма полями", () => {
  const result = parseEvidence([
    { url: "https://a.example", published_date: "2026-01-01", quote: "цитата" },
  ]);
  assert.deepEqual(result, [
    { url: "https://a.example", published_date: "2026-01-01", quote: "цитата" },
  ]);
});

test("parseEvidence: url обов'язковий, published_date і quote — ні", () => {
  const result = parseEvidence([{ url: "https://a.example" }]);
  assert.deepEqual(result, [{ url: "https://a.example", published_date: undefined, quote: undefined }]);
});

test("parseEvidence: запис без url відкидається, а не падає на всьому масиві", () => {
  const result = parseEvidence([{ quote: "без посилання" }, { url: "https://b.example" }]);
  assert.deepEqual(result, [{ url: "https://b.example", published_date: undefined, quote: undefined }]);
});

test("parseEvidence: не-об'єкти й null у масиві відкидаються", () => {
  const result = parseEvidence([null, "рядок", 42, { url: "https://c.example" }]);
  assert.deepEqual(result, [{ url: "https://c.example", published_date: undefined, quote: undefined }]);
});

test("parseEvidence: не-масив на вході — порожній результат, без винятку", () => {
  assert.deepEqual(parseEvidence(null), []);
  assert.deepEqual(parseEvidence(undefined), []);
  assert.deepEqual(parseEvidence("не масив"), []);
  assert.deepEqual(parseEvidence({ url: "https://d.example" }), []);
});

test("groupVerdicts: групує за criterion_key, окремо synthesis і models", () => {
  const rows = [
    verdictRow({ criterion_key: "1", kind: "model", provider: "openai", verdict: "passed" }),
    verdictRow({ criterion_key: "1", kind: "synthesis", provider: "synthesis", verdict: "passed" }),
  ];
  const result = groupVerdicts(rows);
  const entry = result.byKey.get("1")!;
  assert.equal(entry.synthesis?.provider, "synthesis");
  assert.equal(entry.models.length, 1);
  assert.equal(entry.models[0].provider, "openai");
  assert.deepEqual(result.providers, ["openai"]);
});

test("groupVerdicts: моделі всередині criterion_key сортуються за provider", () => {
  const rows = [
    verdictRow({ criterion_key: "1", kind: "model", provider: "openai", verdict: "passed" }),
    verdictRow({ criterion_key: "1", kind: "model", provider: "anthropic", verdict: "passed" }),
  ];
  const result = groupVerdicts(rows);
  assert.deepEqual(
    result.byKey.get("1")!.models.map((m) => m.provider),
    ["anthropic", "openai"],
  );
  assert.deepEqual(result.providers, ["anthropic", "openai"]);
});

test("groupVerdicts: hasDisagreement=true, коли моделі дали різні вердикти по тому самому критерію", () => {
  const rows = [
    verdictRow({ criterion_key: "1", kind: "model", provider: "openai", verdict: "passed" }),
    verdictRow({ criterion_key: "1", kind: "model", provider: "anthropic", verdict: "failed" }),
  ];
  assert.equal(groupVerdicts(rows).hasDisagreement, true);
});

test("groupVerdicts: hasDisagreement=false, коли всі моделі згодні або модель одна", () => {
  const agree = [
    verdictRow({ criterion_key: "1", kind: "model", provider: "openai", verdict: "passed" }),
    verdictRow({ criterion_key: "1", kind: "model", provider: "anthropic", verdict: "passed" }),
  ];
  assert.equal(groupVerdicts(agree).hasDisagreement, false);

  const single = [verdictRow({ criterion_key: "1", kind: "model", provider: "openai", verdict: "passed" })];
  assert.equal(groupVerdicts(single).hasDisagreement, false);
});

test("groupByProvider: враховує лише kind='model', synthesis пропускає", () => {
  const rows = [
    verdictRow({ criterion_key: "1", kind: "model", provider: "openai", verdict: "passed" }),
    verdictRow({ criterion_key: "1", kind: "synthesis", provider: "synthesis", verdict: "passed" }),
  ];
  const result = groupByProvider(rows, "passive-income");
  assert.equal(result.length, 1);
  assert.equal(result[0].provider, "openai");
});

test("groupByProvider: назва критерію береться з чек-листа треку за номером", () => {
  const rows = [verdictRow({ criterion_key: "1", kind: "model", provider: "openai", verdict: "passed" })];
  const result = groupByProvider(rows, "passive-income");
  assert.equal(result[0].items[0].title, "Довіра до джерела");
});

test("groupByProvider: d_-блок бере назву з DEEP_BLOCKS, а не з чек-листа", () => {
  const rows = [verdictRow({ criterion_key: "d_demand", kind: "model", provider: "openai", verdict: "passed" })];
  const result = groupByProvider(rows, "passive-income");
  assert.equal(result[0].items[0].title, "Валідація попиту");
});

test("groupByProvider: невідомий track або невідомий ключ критерію — фолбек «Критерій N»", () => {
  const rows = [verdictRow({ criterion_key: "1", kind: "model", provider: "openai", verdict: "passed" })];
  const unknownTrack = groupByProvider(rows, "no-such-track");
  assert.equal(unknownTrack[0].items[0].title, "Критерій 1");

  const rows2 = [verdictRow({ criterion_key: "99", kind: "model", provider: "openai", verdict: "passed" })];
  const unknownKey = groupByProvider(rows2, "passive-income");
  assert.equal(unknownKey[0].items[0].title, "Критерій 99");
});

test("groupByProvider: числові критерії йдуть перед d_-блоками, а ті — перед незрозумілими ключами", () => {
  const rows = [
    verdictRow({ criterion_key: "d_demand", kind: "model", provider: "p", verdict: "passed" }),
    verdictRow({ criterion_key: "mystery", kind: "model", provider: "p", verdict: "passed" }),
    verdictRow({ criterion_key: "2", kind: "model", provider: "p", verdict: "passed" }),
  ];
  const result = groupByProvider(rows, "passive-income");
  assert.deepEqual(
    result[0].items.map((i) => i.key),
    ["2", "d_demand", "mystery"],
  );
});

test("groupByProvider: model — перше непорожнє значення для провайдера, provider'и сортуються за алфавітом", () => {
  const rows = [
    verdictRow({ criterion_key: "1", kind: "model", provider: "openai", verdict: "passed", model: "gpt-5" }),
    verdictRow({ criterion_key: "2", kind: "model", provider: "openai", verdict: "passed", model: null }),
    verdictRow({ criterion_key: "1", kind: "model", provider: "anthropic", verdict: "passed", model: "claude" }),
  ];
  const result = groupByProvider(rows, "passive-income");
  assert.deepEqual(
    result.map((g) => g.provider),
    ["anthropic", "openai"],
  );
  assert.equal(result.find((g) => g.provider === "openai")!.model, "gpt-5");
});
