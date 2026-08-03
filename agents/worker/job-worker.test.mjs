import assert from "node:assert/strict";
import test from "node:test";
import { backoffFor, buildRunId, commandForJob, createRealtimeSupervisor } from "./job-worker.mjs";

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

function fakeSupabase() {
  const channels = [];
  return {
    channels,
    channel() {
      const ch = {
        listener: null,
        removed: false,
        on() { return ch; },
        subscribe(listener) { ch.listener = listener; return ch; },
      };
      channels.push(ch);
      return ch;
    },
    async removeChannel(ch) {
      ch.removed = true;
      // Реальний клієнт віддає CLOSED знесеному каналу — саме це колись
      // запускало нескінченне коло перепідключень.
      ch.listener?.("CLOSED");
    },
  };
}

test("teardown CLOSED does not schedule another reconnect", async () => {
  const supabase = fakeSupabase();
  const timers = [];
  const supervisor = createRealtimeSupervisor({
    supabase,
    onEvent: () => {},
    onFatal: () => assert.fail("не мало дійти до fatal"),
    emit: () => {},
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
  });

  supervisor.start();
  supabase.channels[0].listener("CHANNEL_ERROR");
  assert.equal(timers.length, 1);

  await timers[0]();

  assert.equal(supabase.channels.length, 2, "має бути рівно один новий канал");
  assert.equal(timers.length, 1, "teardown-CLOSED не планує перепідключення");

  supabase.channels[1].listener("SUBSCRIBED");
  assert.equal(timers.length, 1);
});
