import assert from "node:assert/strict";
import test from "node:test";
import {
  backoffFor,
  buildRunId,
  commandForJob,
  createJobWorker,
  createRealtimeSupervisor,
} from "./job-worker.mjs";

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
  const synthesis = commandForJob({
    type: "deep_research_synthesis",
    payload: { idea_id: "PI-0013" },
  });
  assert.match(synthesis.executable, /deep-research\.sh$/);
  assert.deepEqual(synthesis.args, ["--stage", "synthesis"]);
  assert.equal(synthesis.stdin, '{"idea_id":"PI-0013"}');
  assert.equal(synthesis.successStatus, "ok");

  // Автоматичний fan-out демонтовано: обидва старі типи job більше не мають
  // виконавця, тож повторно поставлені в чергу вони впадуть, а не запустяться.
  assert.throws(() => commandForJob({ type: "deep_research" }), /Непідтримуваний тип job/);
  assert.throws(
    () => commandForJob({ type: "deep_research_competitors" }),
    /Непідтримуваний тип job/,
  );

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
        pgChangesCallback: null,
        removed: false,
        on(event, filter, cb) { ch.pgChangesCallback = cb; return ch; },
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

// ---------------------------------------------------------------------------
// buildRunId — додаткові межі
// ---------------------------------------------------------------------------

test("buildRunId: різні типи job дають різний слаг", () => {
  const date = new Date("2026-01-01T00:00:00Z");
  const a = buildRunId("aaaaaaaa-0000", "telegram_nudge", date);
  const b = buildRunId("aaaaaaaa-0000", "deep_research_synthesis", date);
  assert.match(a, /-telegram-nudge-/);
  assert.match(b, /-deep-research-synthesis-/);
});

test("buildRunId: спецсимволи в типі замінюються на дефіс", () => {
  const date = new Date("2026-01-01T00:00:00Z");
  const result = buildRunId("job-1", "weird!type/thing.exe", date);
  assert.equal(result, "20260101000000-local-weird-type-thing-exe-job-1");
});

test("buildRunId: короткий jobId не обрізається помилково", () => {
  const date = new Date("2026-01-01T00:00:00Z");
  const result = buildRunId("ab", "infrastructure_dry_run", date);
  assert.equal(result, "20260101000000-local-infrastructure-dry-run-ab");
});

test("buildRunId: довгий jobId обрізається до 8 символів", () => {
  const date = new Date("2026-01-01T00:00:00Z");
  const longId = "123456789-abcdefgh-ignored-tail";
  const result = buildRunId(longId, "infrastructure_dry_run", date);
  assert.equal(result, "20260101000000-local-infrastructure-dry-run-12345678");
});

test("buildRunId: детермінований для тих самих аргументів", () => {
  const date = new Date("2026-03-15T09:08:07Z");
  const first = buildRunId("job-xyz", "telegram_update", date);
  const second = buildRunId("job-xyz", "telegram_update", new Date("2026-03-15T09:08:07Z"));
  assert.equal(first, second);
});

test("buildRunId: типовий параметр і дата за замовчуванням не падають", () => {
  const result = buildRunId("job-def");
  assert.match(result, /^\d{14}-local-infrastructure-dry-run-job-def$/);
});

// ---------------------------------------------------------------------------
// backoffFor — додаткові межі
// ---------------------------------------------------------------------------

test("backoffFor: перша й остання спроби масиву", () => {
  assert.equal(backoffFor(1), 1_000);
  assert.equal(backoffFor(5), 120_000);
});

test("backoffFor: нуль і від'ємні значення трактуються як перша спроба", () => {
  assert.equal(backoffFor(0), 1_000);
  assert.equal(backoffFor(-1), 1_000);
  assert.equal(backoffFor(-100), 1_000);
});

test("backoffFor: дробові значення не падають (документує фактичну поведінку)", () => {
  // attempt=1.5 -> Math.max(1.5,1)=1.5 -> Math.min(1.5,5)=1.5 -> index=0.5 ->
  // RECONNECT_BACKOFF_MS[0.5] є undefined, бо масив індексується лише цілими.
  // Викликач завжди передає ціле число (reconnectAttempt), тож на практиці
  // це не трапляється — фіксуємо як задокументовану межу, не як бажану поведінку.
  assert.equal(backoffFor(1.5), undefined);
});

// ---------------------------------------------------------------------------
// commandForJob — межа безпеки (розширено)
// ---------------------------------------------------------------------------

test("commandForJob: відсутній тип у job кидає виняток", () => {
  assert.throws(() => commandForJob({}), /Непідтримуваний тип job: undefined/);
});

test("commandForJob: null/undefined payload для типу без payload не впливає", () => {
  const result = commandForJob({ type: "infrastructure_dry_run", payload: { anything: true } });
  assert.equal(result.stdin, null, "passPayload=false ігнорує payload повністю");
});

test("commandForJob: payload=null для типу з passPayload=true дає stdin '{}'", () => {
  const result = commandForJob({ type: "telegram_update", payload: null });
  assert.equal(result.stdin, "{}");
});

test("commandForJob: payload-не-обʼєкт (рядок) серіалізується без падіння", () => {
  const result = commandForJob({ type: "telegram_update", payload: "garbage" });
  assert.equal(result.stdin, '"garbage"');
});

test("commandForJob: зайві поля в payload просто йдуть у stdin, не читаються окремо", () => {
  const result = commandForJob({
    type: "deep_research_synthesis",
    payload: { idea_id: "PI-1", unexpected: { nested: true } },
  });
  assert.equal(result.stdin, '{"idea_id":"PI-1","unexpected":{"nested":true}}');
});

test("commandForJob: payload не може підмінити executable/args/timeout", () => {
  const malicious = {
    type: "infrastructure_dry_run",
    payload: {
      executable: "/bin/rm",
      args: ["-rf", "/"],
      timeoutMs: 1,
      successStatus: "hacked",
    },
  };
  const result = commandForJob(malicious);
  assert.match(result.executable, /infrastructure-dry-run\.sh$/);
  assert.deepEqual(result.args, []);
  assert.equal(result.timeoutMs, 60_000);
  assert.equal(result.successStatus, "dry_run");
});

test("commandForJob: тип job не може підмінити executable напряму", () => {
  const malicious = { type: "infrastructure_dry_run", executable: "/bin/rm" };
  const result = commandForJob(malicious);
  assert.match(result.executable, /infrastructure-dry-run\.sh$/, "поле job.executable ігнорується повністю");
});

test("commandForJob: executable завжди один із чотирьох відомих шляхів", () => {
  const known = [
    /infrastructure-dry-run\.sh$/,
    /deep-research\.sh$/,
    /telegram-bot\.py$/,
  ];
  for (const type of ["infrastructure_dry_run", "deep_research_synthesis", "telegram_update", "telegram_nudge"]) {
    const { executable } = commandForJob({ type });
    assert.ok(known.some((re) => re.test(executable)), `${type} -> ${executable}`);
  }
});

test("commandForJob: успадковані ключі Object.prototype НЕ мають проходити allowlist (сумнівна поведінка)", () => {
  // ФАКТ: JOB_HANDLERS — звичайний obj-literal, тож успадковує Object.prototype.
  // `JOB_HANDLERS["toString"]` не undefined (це успадкована функція), тож
  // перевірка `if (!handler) throw` пропускає її. Наслідок: замість очікуваного
  // "Непідтримуваний тип job" викликач отримує { stdin: null } без жодного
  // executable/args — сама по собі не exec-дірка (spawn(undefined) впаде), але
  // порушує заявлений інваріант "лише 4 дозволені типи або виняток".
  for (const type of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
    const result = commandForJob({ type });
    assert.equal(result.executable, undefined, `${type}: executable лишається undefined, не з ужитку`);
  }
});

test("commandForJob: job=null падає TypeError, а не доменним Error (документує факт)", () => {
  assert.throws(() => commandForJob(null), TypeError);
});

test("commandForJob: демонтовані типи (deep_research, deep_research_competitors) кидають виняток з будь-яким payload", () => {
  assert.throws(() => commandForJob({ type: "deep_research", payload: { x: 1 } }), /Непідтримуваний тип job/);
  assert.throws(
    () => commandForJob({ type: "deep_research_competitors", payload: null }),
    /Непідтримуваний тип job/,
  );
});

// ---------------------------------------------------------------------------
// createRealtimeSupervisor — послідовності станів
// ---------------------------------------------------------------------------

function fakeSupabaseWithCalls() {
  const channels = [];
  const removeChannelCalls = [];
  return {
    channels,
    removeChannelCalls,
    channel() {
      const ch = {
        listener: null,
        on() { return ch; },
        subscribe(listener) { ch.listener = listener; return ch; },
      };
      channels.push(ch);
      return ch;
    },
    async removeChannel(ch) {
      removeChannelCalls.push(ch);
      ch.removed = true;
    },
  };
}

function timerHarness() {
  const scheduled = [];
  return {
    scheduled,
    setTimer(fn, delay) {
      const entry = { fn, delay, cleared: false };
      scheduled.push(entry);
      return entry;
    },
    clearTimer(entry) {
      if (entry) entry.cleared = true;
    },
    async fireNext() {
      const entry = scheduled.find((e) => !e.cleared && !e.fired);
      if (!entry) throw new Error("немає незапущеного таймера");
      entry.fired = true;
      await entry.fn();
      return entry;
    },
  };
}

test("SUBSCRIBED після reconnect скидає лічильник спроб (наступна помилка знову #1)", async () => {
  const supabase = fakeSupabaseWithCalls();
  const emits = [];
  const timers = timerHarness();
  const supervisor = createRealtimeSupervisor({
    supabase,
    onEvent: () => {},
    onFatal: () => assert.fail("не мало дійти до fatal"),
    emit: (msg) => emits.push(msg),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  supervisor.start();
  supabase.channels[0].listener("CHANNEL_ERROR");
  assert.match(emits.at(-1), /reconnect #1 через 1000 ms/);

  await timers.fireNext();
  supabase.channels[1].listener("SUBSCRIBED");

  // Друга помилка після відновлення знову має піти з відліку #1, а не #2.
  supabase.channels[1].listener("CHANNEL_ERROR");
  assert.match(emits.at(-1), /reconnect #1 через 1000 ms/);
});

test("кілька помилок підряд до спрацювання таймера планують лише один reconnect", async () => {
  const supabase = fakeSupabaseWithCalls();
  const timers = timerHarness();
  const supervisor = createRealtimeSupervisor({
    supabase,
    onEvent: () => {},
    onFatal: () => assert.fail("не мало дійти до fatal"),
    emit: () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  supervisor.start();
  supabase.channels[0].listener("CHANNEL_ERROR");
  supabase.channels[0].listener("TIMED_OUT");
  supabase.channels[0].listener("CLOSED");
  assert.equal(timers.scheduled.filter((e) => !e.cleared).length, 1, "лише один запланований reconnect");
});

test("вичерпання MAX_RECONNECT_ATTEMPTS викликає onFatal і більше не планує reconnect", async () => {
  const supabase = fakeSupabaseWithCalls();
  const emits = [];
  const timers = timerHarness();
  let fatalCalls = 0;
  const supervisor = createRealtimeSupervisor({
    supabase,
    onEvent: () => {},
    onFatal: () => { fatalCalls += 1; },
    emit: (msg) => emits.push(msg),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  supervisor.start();
  // 6 невдалих циклів поспіль -> attempt 1..6; на 7-й виклик scheduleReconnect
  // (attempt=7 > MAX=6) вже йде у гілку fatal.
  for (let i = 0; i < 6; i += 1) {
    const chIndex = supabase.channels.length - 1;
    supabase.channels[chIndex].listener("CHANNEL_ERROR");
    await timers.fireNext();
  }
  const lastCh = supabase.channels.at(-1);
  lastCh.listener("CHANNEL_ERROR");

  assert.equal(fatalCalls, 1);
  assert.match(emits.at(-1), /fatal: realtime не піднявся за 6 спроб/);

  // Після fatal подальші помилки не повинні планувати нові таймери.
  const scheduledBefore = timers.scheduled.filter((e) => !e.cleared && !e.fired).length;
  lastCh.listener("CHANNEL_ERROR");
  const scheduledAfter = timers.scheduled.filter((e) => !e.cleared && !e.fired).length;
  assert.equal(scheduledAfter, scheduledBefore, "після fatal лічильник спроб більше не зростає — reconnectTimer лишається null, але stopping теж лишається false: це задокументована межа, не catch-all guard");
});

test("teardown посеред очікування reconnect: stop() скасовує таймер і блокує його ефект", async () => {
  const supabase = fakeSupabaseWithCalls();
  const timers = timerHarness();
  const supervisor = createRealtimeSupervisor({
    supabase,
    onEvent: () => {},
    onFatal: () => assert.fail("не мало дійти до fatal"),
    emit: () => {},
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  supervisor.start();
  supabase.channels[0].listener("CHANNEL_ERROR");
  const pending = timers.scheduled[0];
  assert.equal(pending.cleared, false);

  await supervisor.stop();
  assert.equal(pending.cleared, true, "clearTimer викликано для активного reconnect-таймера");
  assert.equal(supabase.removeChannelCalls.length, 1);

  // Якби реальний таймер все ж вистрелив (гонка), stopping-прапор має
  // заблокувати відкриття нового каналу.
  const channelsBefore = supabase.channels.length;
  await pending.fn();
  assert.equal(supabase.channels.length, channelsBefore, "openChannel() не викликається після stop()");
});

test("повторний stop() не падає і не викликає removeChannel вдруге", async () => {
  const supabase = fakeSupabaseWithCalls();
  const supervisor = createRealtimeSupervisor({
    supabase,
    onEvent: () => {},
    onFatal: () => assert.fail("не мало дійти до fatal"),
    emit: () => {},
  });

  supervisor.start();
  await supervisor.stop();
  assert.equal(supabase.removeChannelCalls.length, 1);

  await supervisor.stop();
  assert.equal(supabase.removeChannelCalls.length, 1, "другий stop() не чіпає вже знесений канал");
});

test("reconnectNow(): скидає лічильник, скасовує активний таймер і планує негайний reconnect", async () => {
  const supabase = fakeSupabaseWithCalls();
  const emits = [];
  const timers = timerHarness();
  const supervisor = createRealtimeSupervisor({
    supabase,
    onEvent: () => {},
    onFatal: () => assert.fail("не мало дійти до fatal"),
    emit: (msg) => emits.push(msg),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  supervisor.start();
  supabase.channels[0].listener("CHANNEL_ERROR"); // attempt=1, таймер на 1000мс
  supabase.channels[0].listener("CHANNEL_ERROR"); // проігноровано: reconnectTimer вже стоїть

  const firstTimer = timers.scheduled[0];
  supervisor.reconnectNow();
  assert.equal(firstTimer.cleared, true, "старий таймер скасовано");
  assert.match(emits.at(-1), /reconnect #1 через 0 ms/);

  await timers.fireNext();
  assert.equal(supabase.channels.length, 2);
});

test("removeChannel, що падає під час reconnect, не блокує відкриття нового каналу", async () => {
  const channels = [];
  const emits = [];
  const timers = timerHarness();
  const supabase = {
    channel() {
      const ch = { on() { return ch; }, subscribe(listener) { ch.listener = listener; return ch; } };
      channels.push(ch);
      return ch;
    },
    async removeChannel() {
      throw new Error("боум");
    },
  };
  const supervisor = createRealtimeSupervisor({
    supabase,
    onEvent: () => {},
    onFatal: () => assert.fail("не мало дійти до fatal"),
    emit: (msg) => emits.push(msg),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  supervisor.start();
  channels[0].listener("CHANNEL_ERROR");
  await timers.fireNext();

  assert.ok(emits.some((m) => m.includes("realtime removeChannel failed: боум")));
  assert.equal(channels.length, 2, "новий канал все одно відкрився попри помилку removeChannel");
});

test("postgres_changes подія викликає onEvent", () => {
  const supabase = fakeSupabaseWithCalls();
  let events = 0;
  let capturedCb = null;
  supabase.channel = function channel() {
    const ch = {
      on(event, filter, cb) { capturedCb = cb; return ch; },
      subscribe(listener) { ch.listener = listener; return ch; },
    };
    return ch;
  };
  const supervisor = createRealtimeSupervisor({
    supabase,
    onEvent: () => { events += 1; },
    onFatal: () => {},
    emit: () => {},
  });
  supervisor.start();
  capturedCb({});
  assert.equal(events, 1);
});

// ---------------------------------------------------------------------------
// createJobWorker — мок Supabase
// ---------------------------------------------------------------------------

/**
 * Мінімальний мок query-builder'а supabase-js під форму викликів у job-worker.mjs:
 *   .from("jobs").update(fields).eq().eq().eq().select("id")
 *   .from("runs").insert(row)
 *   .from("runs").update(fields).eq("run_id", id)
 *   .rpc("claim_next_job", { p_worker_id, p_lease_seconds })
 */
function makeSupabaseMock({
  claimQueue = [],
  jobsUpdateResult = () => ({ data: [{ id: "job" }], error: null }),
  runsInsertResult = () => ({ error: null }),
  runsUpdateResult = () => ({ error: null }),
} = {}) {
  let claimIndex = 0;
  const calls = { rpc: [], jobsUpdate: [], runsInsert: [], runsUpdate: [] };

  return {
    calls,
    rpc(name, args) {
      calls.rpc.push({ name, args });
      const next = claimIndex < claimQueue.length ? claimQueue[claimIndex++] : undefined;
      if (next instanceof Error) return Promise.resolve({ data: null, error: next });
      if (next === null || next === undefined) return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [next], error: null });
    },
    from(table) {
      if (table === "jobs") {
        let fields = null;
        const filters = {};
        const builder = {
          update(f) { fields = f; return builder; },
          eq(col, val) { filters[col] = val; return builder; },
          select() {
            const record = { fields, filters: { ...filters } };
            calls.jobsUpdate.push(record);
            return Promise.resolve(jobsUpdateResult(record));
          },
        };
        return builder;
      }
      if (table === "runs") {
        return {
          insert(row) {
            calls.runsInsert.push(row);
            return Promise.resolve(runsInsertResult(row));
          },
          update(fields) {
            const filters = {};
            return {
              eq(col, val) {
                filters[col] = val;
                const record = { fields, filters: { ...filters } };
                calls.runsUpdate.push(record);
                return Promise.resolve(runsUpdateResult(record));
              },
            };
          },
        };
      }
      throw new Error(`неочікувана таблиця в тесті: ${table}`);
    },
  };
}

async function captureStdout(fn) {
  const original = process.stdout.write;
  const lines = [];
  process.stdout.write = (chunk) => { lines.push(chunk.toString()); return true; };
  try {
    await fn();
  } finally {
    process.stdout.write = original;
  }
  return lines;
}

test("drain(): порожня черга — жодного job не виконується, rpc викликано з правильними аргументами", async () => {
  const supabase = makeSupabaseMock({ claimQueue: [] });
  const worker = createJobWorker({ supabase, workerId: "host:1" });
  await worker.drain();
  assert.equal(supabase.calls.rpc.length, 1);
  assert.deepEqual(supabase.calls.rpc[0].args, { p_worker_id: "host:1", p_lease_seconds: 300 });
  assert.equal(supabase.calls.jobsUpdate.length, 0);
  assert.equal(supabase.calls.runsInsert.length, 0);
});

test("drain(): rpc data=null (без помилки) трактується як 'немає job'", async () => {
  const supabase = makeSupabaseMock();
  supabase.rpc = (name, args) => {
    supabase.calls.rpc.push({ name, args });
    return Promise.resolve({ data: null, error: null });
  };
  const worker = createJobWorker({ supabase, workerId: "host:1" });
  await worker.drain();
  assert.equal(supabase.calls.rpc.length, 1);
});

test("drain(): rpc повертає помилку — логується 'queue drain failed', draining не залипає", async () => {
  const supabase = makeSupabaseMock();
  let calls = 0;
  supabase.rpc = () => {
    calls += 1;
    return Promise.resolve({ data: null, error: new Error("зв'язок із БД відвалився") });
  };
  const worker = createJobWorker({ supabase, workerId: "host:1" });

  const lines = await captureStdout(() => worker.drain());
  assert.ok(lines.some((l) => l.includes("queue drain failed: зв'язок із БД відвалився")));

  // Якби draining лишився true, другий виклик одразу вийшов би без нового rpc.
  await worker.drain();
  assert.equal(calls, 2, "після помилки drain() знову виконується при наступному виклику");
});

test("drain(): непідтримуваний тип job -> job позначається 'failed' без спроби виконати процес", async () => {
  const job = { id: "job-1", type: "unknown_type", claim_token: "tok-1", attempt_count: 1 };
  const supabase = makeSupabaseMock({ claimQueue: [job] });
  const worker = createJobWorker({ supabase, workerId: "host:1" });

  await worker.drain();

  assert.equal(supabase.calls.runsInsert.length, 0, "run для непідтримуваного типу не створюється — spawn ніколи не викликається");
  assert.equal(supabase.calls.jobsUpdate.length, 1);
  const { fields, filters } = supabase.calls.jobsUpdate[0];
  assert.deepEqual(Object.keys(fields).sort(), ["finished_at", "last_error", "lease_expires_at", "run_id", "status"].sort());
  assert.equal(fields.status, "failed");
  assert.equal(fields.run_id, null);
  assert.equal(fields.lease_expires_at, null);
  assert.match(fields.last_error, /Непідтримуваний тип job: unknown_type/);
  assert.deepEqual(filters, { id: "job-1", status: "running", claim_token: "tok-1" });
});

test("drain(): якщо lease вже втрачено (claim_token не збігається), finishJob кидає і не позначає job мовчки (ідемпотентність)", async () => {
  const job = { id: "job-2", type: "unknown_type", claim_token: "tok-stale", attempt_count: 1 };
  const supabase = makeSupabaseMock({
    claimQueue: [job],
    jobsUpdateResult: () => ({ data: [], error: null }), // 0 рядків -> lease більше не належить воркеру
  });
  const worker = createJobWorker({ supabase, workerId: "host-A:99" });

  const lines = await captureStdout(() => worker.drain());
  assert.ok(
    lines.some((l) => l.includes("Lease job job-2 більше не належить host-A:99")),
    "втрата lease видима в логах, а не проковтується мовчки",
  );
});

test("drain(): Supabase повертає помилку на insert у runs -> job позначається 'failed', процес не запускається", async () => {
  const job = { id: "job-3", type: "infrastructure_dry_run", claim_token: "tok-3", attempt_count: 2 };
  const supabase = makeSupabaseMock({
    claimQueue: [job],
    runsInsertResult: () => ({ error: new Error("insert відхилено PGRST102") }),
  });
  const worker = createJobWorker({ supabase, workerId: "host:1" });

  const lines = await captureStdout(() => worker.drain());

  assert.equal(supabase.calls.runsInsert.length, 1, "insert викликано рівно раз — spawn ще не встиг стартувати");
  assert.equal(supabase.calls.jobsUpdate.length, 1);
  const { fields } = supabase.calls.jobsUpdate[0];
  assert.equal(fields.status, "failed");
  assert.match(fields.last_error, /Не вдалося створити run: insert відхилено PGRST102/);
  assert.ok(lines.some((l) => l.includes("worker error: insert відхилено PGRST102")));
});

test("drain(): job зникає між insert run і attach (0 рядків оновлено) -> кидає помилку, ЩО job лишається без finishJob (сумнівно)", async () => {
  const job = { id: "job-4", type: "infrastructure_dry_run", claim_token: "tok-4", attempt_count: 1 };
  const supabase = makeSupabaseMock({
    claimQueue: [job],
    jobsUpdateResult: ({ fields }) => {
      // Виклик attach передає лише { run_id }; саме на ньому симулюємо втрату
      // job'а (наприклад, інший воркер перехопив lease між insert і attach).
      if (fields && Object.keys(fields).length === 1 && "run_id" in fields) {
        return { data: [], error: null };
      }
      return { data: [{ id: job.id }], error: null };
    },
  });
  const worker = createJobWorker({ supabase, workerId: "host:1" });

  const lines = await captureStdout(() => worker.drain());

  assert.equal(supabase.calls.runsInsert.length, 1, "run-рядок встиг створитися до втрати job'а");
  assert.ok(
    lines.some((l) => l.includes(`worker error: Не вдалося прив'язати run`) && l.includes("job-4")),
  );
  // ФАКТ (сумнівно): на цій гілці finishJob() НЕ викликається — job лишається
  // у статусі "running" з lease без фінального fields-запису, а run-рядок,
  // щойно вставлений як status:"running", теж ніколи не оновлюється. Job
  // "зависає" до природного витікання lease, а не позначається failed одразу.
  assert.equal(
    supabase.calls.jobsUpdate.filter((c) => c.fields.status === "failed").length,
    0,
    "жодного явного 'failed' запису для job-4 не сталося",
  );
});

test("drain(): job зі структурою payload, що не є обʼєктом (null, скаляр) — не ламає виконання insert-фази", async () => {
  const job = { id: "job-5", type: "telegram_update", payload: null, claim_token: "tok-5", attempt_count: 1 };
  const supabase = makeSupabaseMock({
    claimQueue: [job],
    runsInsertResult: () => ({ error: new Error("stop-before-spawn") }),
  });
  const worker = createJobWorker({ supabase, workerId: "host:1" });
  await worker.drain();
  assert.equal(supabase.calls.runsInsert.length, 1);
  const row = supabase.calls.runsInsert[0];
  assert.equal(row.job, "telegram-update");
  assert.equal(row.provider, "local");
  assert.equal(row.status, "running");
});

test("drain(): meta у runs.insert містить job_id/worker_id/attempt і НЕ містить idea_id для типів без нього", async () => {
  const job = { id: "job-6", type: "infrastructure_dry_run", claim_token: "tok-6", attempt_count: 3 };
  const supabase = makeSupabaseMock({
    claimQueue: [job],
    runsInsertResult: () => ({ error: new Error("stop-before-spawn") }),
  });
  const worker = createJobWorker({ supabase, workerId: "worker-X" });
  await worker.drain();

  const row = supabase.calls.runsInsert[0];
  assert.deepEqual(Object.keys(row.meta).sort(), ["attempt", "job_id", "worker_id"]);
  assert.equal(row.meta.job_id, "job-6");
  assert.equal(row.meta.worker_id, "worker-X");
  assert.equal(row.meta.attempt, 3);
});

test("drain(): meta у runs.insert включає idea_id лише для deep_research_synthesis з payload.idea_id-рядком", async () => {
  const supabase = makeSupabaseMock({
    claimQueue: [
      { id: "job-7", type: "deep_research_synthesis", payload: { idea_id: "PI-42" }, claim_token: "t7", attempt_count: 1 },
    ],
    runsInsertResult: () => ({ error: new Error("stop-before-spawn") }),
  });
  const worker = createJobWorker({ supabase, workerId: "w" });
  await worker.drain();
  assert.equal(supabase.calls.runsInsert[0].meta.idea_id, "PI-42");
});

test("drain(): idea_id, що не є рядком, ігнорується в meta (документує typeof-перевірку)", async () => {
  const supabase = makeSupabaseMock({
    claimQueue: [
      { id: "job-8", type: "deep_research_synthesis", payload: { idea_id: 42 }, claim_token: "t8", attempt_count: 1 },
    ],
    runsInsertResult: () => ({ error: new Error("stop-before-spawn") }),
  });
  const worker = createJobWorker({ supabase, workerId: "w" });
  await worker.drain();
  assert.ok(!("idea_id" in supabase.calls.runsInsert[0].meta));
});

test("drain(): помилка на одному job не зупиняє обробку черги — цикл продовжується до наступного job", async () => {
  const jobA = { id: "job-A", type: "unknown", claim_token: "a", attempt_count: 1 };
  const jobB = { id: "job-B", type: "also-unknown", claim_token: "b", attempt_count: 1 };
  const supabase = makeSupabaseMock({
    claimQueue: [jobA, jobB],
    jobsUpdateResult: () => ({ data: [], error: null }), // обидва finishJob провалюються -> throw
  });
  const worker = createJobWorker({ supabase, workerId: "host:1" });

  await captureStdout(() => worker.drain());

  // 2 job + завершальний null = 3 виклики rpc.
  assert.equal(supabase.calls.rpc.length, 3);
});

test("drain(): повторний виклик під час активного drain лише позначає drainRequested — не запускає паралельний прохід", async () => {
  const jobs = [
    { id: "j-1", type: "unknown", claim_token: "1", attempt_count: 1 },
  ];
  const supabase = makeSupabaseMock({ claimQueue: jobs });
  const worker = createJobWorker({ supabase, workerId: "host:1" });

  const first = worker.drain();
  const second = worker.drain(); // синхронно застає draining=true -> drainRequested=true, повертається одразу

  await Promise.all([first, second]);

  // 1 job + null (кінець першого проходу) + ще один null (додатковий прохід
  // через drainRequested, виставлений другим викликом) = 3 rpc-виклики.
  assert.equal(supabase.calls.rpc.length, 3);
  assert.equal(supabase.calls.jobsUpdate.length, 1, "job із черги виконався рівно один раз — без дублю");
});

test("drain(): claim_next_job не повертає той самий job двічі поспіль без повторного rpc (немає прихованого кешування)", async () => {
  const jobs = [
    { id: "job-once", type: "unknown", claim_token: "x", attempt_count: 1 },
  ];
  const supabase = makeSupabaseMock({ claimQueue: jobs });
  const worker = createJobWorker({ supabase, workerId: "host:1" });
  await worker.drain();
  assert.equal(supabase.calls.jobsUpdate.length, 1, "job-once оброблено рівно один раз за весь drain()");
});
