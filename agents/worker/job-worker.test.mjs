import assert from "node:assert/strict";
import test from "node:test";
import { buildRunId, commandForJob } from "./job-worker.mjs";

test("buildRunId includes deterministic timestamp and job prefix", () => {
  const result = buildRunId("12345678-abcd-ef00-1234-56789abcdef0", new Date("2026-07-31T12:34:56Z"));
  assert.equal(result, "20260731123456-local-infrastructure-dry-run-12345678");
});

test("worker only resolves allowlisted job types", () => {
  assert.match(commandForJob({ type: "infrastructure_dry_run" }).executable, /infrastructure-dry-run\.sh$/);
  assert.throws(() => commandForJob({ type: "arbitrary_command" }), /Непідтримуваний тип job/);
});
