import assert from "node:assert/strict";
import test from "node:test";
import { buildIdeaTree } from "./tree.ts";
import type { Idea } from "./types.ts";

const matchAll = () => true;

function idea(overrides: Partial<Idea> & { id: string }): Idea {
  return {
    track: "passive-income",
    parent_id: null,
    title: overrides.id,
    type: "niche",
    discovered: "2026-01-01",
    signal_type: "income_claim",
    monetization_hypothesis: null,
    mentions_count: 1,
    claimed_revenue: null,
    mechanic_summary: null,
    status: "new",
    rejection_code: null,
    rejection_detail: null,
    rejection_other_reason: null,
    rejection_codes_extra: [],
    missing_capabilities: [],
    ceiling_estimate: null,
    launch_effort_hours: null,
    ceiling_flag: null,
    review_condition: null,
    review_count: 0,
    last_reviewed: null,
    min_review_interval_days: 0,
    confidence: null,
    transferred_to: null,
    verdict_provider: null,
    verdict_model: null,
    verdict_run_id: null,
    research_depth: "initial",
    deep_researched_at: null,
    deep_research_run_id: null,
    schema_version: 1,
    criteria_version: null,
    body: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("порожній список ідей — порожнє дерево", () => {
  assert.deepEqual(buildIdeaTree([], matchAll, "asc"), []);
});

test("один вузол без батька — сам собі корінь без дітей", () => {
  const a = idea({ id: "A" });
  const result = buildIdeaTree([a], matchAll, "asc");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "A");
  assert.deepEqual(result[0].children, []);
  assert.equal(result[0].dimmed, false);
});

test("батько з дітьми — діти вкладені під коренем", () => {
  const parent = idea({ id: "P" });
  const child1 = idea({ id: "C1", parent_id: "P", discovered: "2026-01-02" });
  const child2 = idea({ id: "C2", parent_id: "P", discovered: "2026-01-03" });
  const result = buildIdeaTree([parent, child1, child2], matchAll, "asc");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "P");
  assert.deepEqual(
    result[0].children.map((c) => c.id),
    ["C1", "C2"],
  );
});

test("сирота: parent_id вказує на неіснуючу ідею — стає власним коренем", () => {
  const orphan = idea({ id: "O", parent_id: "does-not-exist" });
  const result = buildIdeaTree([orphan], matchAll, "asc");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "O");
  assert.deepEqual(result[0].children, []);
});

test("цикл A→B→A: обидва вузли стають власними коренями (не зникають, не крашиться, не висне)", () => {
  const a = idea({ id: "A", parent_id: "B" });
  const b = idea({ id: "B", parent_id: "A" });
  const result = buildIdeaTree([a, b], matchAll, "asc");
  // Жоден вузол циклу не задовольняє звичайну умову "корінь" (parent_id
  // заданий і знайдений), тож без спеціального опрацювання цикл випав би з
  // дерева цілком; натомість isInCycle() підхоплює обидва як власні корені,
  // без дітей одне в одного (інакше вони дублювались би нескінченно).
  assert.deepEqual(
    result.map((n) => n.id),
    ["A", "B"],
  );
  assert.deepEqual(result[0].children, []);
  assert.deepEqual(result[1].children, []);
});

test("цикл із трьох вузлів A→B→C→A так само лишається видимим — усі три власні корені", () => {
  const a = idea({ id: "A", parent_id: "C" });
  const b = idea({ id: "B", parent_id: "A" });
  const c = idea({ id: "C", parent_id: "B" });
  const result = buildIdeaTree([a, b, c], matchAll, "asc");
  assert.deepEqual(
    result.map((n) => n.id),
    ["A", "B", "C"],
  );
});

test("вузол, що є власним батьком (parent_id === id), теж лишається видимим як власний корінь", () => {
  const self = idea({ id: "S", parent_id: "S" });
  const result = buildIdeaTree([self], matchAll, "asc");
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "S");
  assert.deepEqual(result[0].children, []);
});

test("цикл не заважає іншим коренями лишатись видимими — і сам цикл теж лишається видимим", () => {
  const untouched = idea({ id: "U" });
  const a = idea({ id: "A", parent_id: "B" });
  const b = idea({ id: "B", parent_id: "A" });
  const result = buildIdeaTree([untouched, a, b], matchAll, "asc");
  assert.deepEqual(
    result.map((n) => n.id),
    ["U", "A", "B"],
  );
});

test("сортування коренів за датою: asc і desc", () => {
  const early = idea({ id: "EARLY", discovered: "2026-01-01" });
  const late = idea({ id: "LATE", discovered: "2026-02-01" });

  const asc = buildIdeaTree([late, early], matchAll, "asc");
  assert.deepEqual(
    asc.map((n) => n.id),
    ["EARLY", "LATE"],
  );

  const desc = buildIdeaTree([early, late], matchAll, "desc");
  assert.deepEqual(
    desc.map((n) => n.id),
    ["LATE", "EARLY"],
  );
});

test("сортування дітей за датою так само підпорядковане sortDir", () => {
  const parent = idea({ id: "P" });
  const c1 = idea({ id: "C1", parent_id: "P", discovered: "2026-01-05" });
  const c2 = idea({ id: "C2", parent_id: "P", discovered: "2026-01-01" });
  const result = buildIdeaTree([parent, c1, c2], matchAll, "desc");
  assert.deepEqual(
    result[0].children.map((c) => c.id),
    ["C1", "C2"],
  );
});

test("batьк не збігається з фільтром, але діти збігаються — лишається dimmed", () => {
  const parent = idea({ id: "P", title: "mechanic" });
  const child = idea({ id: "C", parent_id: "P", title: "matching niche" });
  const matches = (i: Idea) => i.title === "matching niche";
  const result = buildIdeaTree([parent, child], matches, "asc");
  assert.equal(result.length, 1);
  assert.equal(result[0].dimmed, true);
  assert.deepEqual(
    result[0].children.map((c) => c.id),
    ["C"],
  );
});

test("батько не збігається і жодна дитина не збігається — вузол пропадає повністю", () => {
  const parent = idea({ id: "P", title: "mechanic" });
  const child = idea({ id: "C", parent_id: "P", title: "unrelated" });
  const matches = (i: Idea) => i.title === "matching niche";
  const result = buildIdeaTree([parent, child], matches, "asc");
  assert.deepEqual(result, []);
});

test("діти, які не проходять фільтр, повністю зникають — не показуються dimmed", () => {
  const parent = idea({ id: "P", title: "matches" });
  const good = idea({ id: "GOOD", parent_id: "P", title: "matches" });
  const bad = idea({ id: "BAD", parent_id: "P", title: "no match" });
  const matches = (i: Idea) => i.title === "matches";
  const result = buildIdeaTree([parent, good, bad], matches, "asc");
  assert.equal(result[0].dimmed, false);
  assert.deepEqual(
    result[0].children.map((c) => c.id),
    ["GOOD"],
  );
});
