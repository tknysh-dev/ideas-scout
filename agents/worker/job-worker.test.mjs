import assert from "node:assert/strict";
import test from "node:test";
import { backoffFor, buildRunId, commandForJob } from "./job-worker.mjs";

test("buildRunId includes deterministic timestamp and job prefix", () => {
  const result = buildRunId(
    "12345678-abcd-ef00-1234-56789abcdef0",
    "infrastructure_dry_run",
    new Date("2026-07-31T12:34:56Z"),
  );
  assert.equal(result, "20260731123456-local-infrastructure-dry-run-12345678");
});

test("worker only resolves allowlisted job types", () => {
  assert.match(commandForJob({ type: "infrastructure_dry_run" }).executable, /infrastructure-dry-run\.sh$/);
  const research = commandForJob({
    type: "deep_research",
    payload: { idea_id: "PI-0013" },
  });
  assert.match(research.executable, /deep-research\.sh$/);
  assert.equal(research.stdin, '{"idea_id":"PI-0013"}');
  assert.equal(research.successStatus, "dry_run");

  const telegram = commandForJob({
    type: "telegram_update",
    payload: { update: { update_id: 42 } },
  });
  assert.match(telegram.executable, /telegram-bot\.py$/);
  assert.deepEqual(telegram.args, ["--process-update"]);
  assert.equal(telegram.stdin, '{"update":{"update_id":42}}');
  assert.equal(telegram.successStatus, "ok");

  const nudge = commandForJob({ type: "telegram_nudge" });
  assert.deepEqual(nudge.args, ["--nudge"]);
  assert.equal(nudge.stdin, null);
  assert.throws(() => commandForJob({ type: "arbitrary_command" }), /Непідтримуваний тип job/);
});

test("realtime reconnect backoff grows and saturates", () => {
  assert.equal(backoffFor(1), 1_000);
  assert.equal(backoffFor(4), 60_000);
  assert.equal(backoffFor(5), 120_000);
  assert.equal(backoffFor(99), 120_000);
});
