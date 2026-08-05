import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORKER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(WORKER_DIR, "../..");
const LEASE_SECONDS = 300;
const HEARTBEAT_MS = 60_000;
const SAFETY_SWEEP_MS = 300_000;
const WATCHDOG_MS = 30_000;
// Уві сні Mac таймери не тікають, тому аномально великий розрив між тіками
// watchdog — надійніший сигнал пробудження, ніж будь-яка подія macOS.
const WAKE_GAP_MS = 90_000;
const RECONNECT_BACKOFF_MS = Object.freeze([1_000, 5_000, 15_000, 60_000, 120_000]);
const MAX_RECONNECT_ATTEMPTS = 6;
const OUTPUT_LIMIT = 64 * 1024;

/**
 * @typedef {Object} Job
 * @property {string} id
 * @property {string} type
 * @property {unknown} [payload]
 * @property {string} claim_token
 * @property {number} attempt_count
 */

/**
 * @typedef {Object} JobHandler
 * @property {string} executable
 * @property {string[]} args
 * @property {number} timeoutMs
 * @property {boolean} passPayload
 * @property {string} successStatus
 * @property {string} successNote
 * @property {string} failureNote
 */

/**
 * Мінімальний зріз клієнта supabase-js, яким реально користується воркер —
 * замість повних (і DOM-залежних) типів бібліотеки описуємо лише те, що
 * job-worker.mjs викликає, з точними формами полів jobs/runs.
 * @typedef {Object} JobsUpdateFields
 * @property {string | null} [run_id]
 * @property {"succeeded" | "failed"} [status]
 * @property {string} [finished_at]
 * @property {string | null} [lease_expires_at]
 * @property {string | null} [last_error]
 *
 * @typedef {Object} JobsQueryBuilder
 * @property {(fields: JobsUpdateFields) => JobsQueryBuilder} update
 * @property {(column: string, value: unknown) => JobsQueryBuilder} eq
 * @property {(columns?: string) => Promise<{data: {id: string}[] | null, error: Error | null}>} select
 *
 * @typedef {Object} RunsInsertRow
 * @property {string} run_id
 * @property {string} job
 * @property {"local"} provider
 * @property {string} started_at
 * @property {string} status
 * @property {Record<string, unknown>} meta
 *
 * @typedef {Object} RunsUpdateFields
 * @property {string} finished_at
 * @property {string} status
 * @property {string[]} errors
 * @property {string} notes
 * @property {Record<string, unknown>} meta
 *
 * @typedef {Object} RunsQueryBuilder
 * @property {(row: RunsInsertRow) => Promise<{error: Error | null}>} insert
 * @property {(fields: RunsUpdateFields) => {eq: (column: string, value: unknown) => Promise<{error: Error | null}>}} update
 *
 * @typedef {Object} SupabaseWorkerClient
 * @property {(table: string) => JobsQueryBuilder | RunsQueryBuilder} from
 * @property {(fn: string, args: Record<string, unknown>) => Promise<{data: Job[] | null, error: Error | null}>} rpc
 *
 * @typedef {Object} RealtimeChannel
 * @property {(event: string, filter: Record<string, unknown>, cb: () => void) => RealtimeChannel} on
 * @property {(listener: (status: string) => void) => RealtimeChannel} subscribe
 *
 * @typedef {Object} SupabaseRealtimeClient
 * @property {(name: string) => RealtimeChannel} channel
 * @property {(channel: RealtimeChannel) => Promise<void>} removeChannel
 */

const JOB_HANDLERS = Object.freeze({
  infrastructure_dry_run: Object.freeze({
    executable: join(REPO_ROOT, "agents/scripts/infrastructure-dry-run.sh"),
    args: [],
    timeoutMs: 60_000,
    passPayload: false,
    successStatus: "dry_run",
    successNote: "Інфраструктурний dry run успішно виконано.",
    failureNote: "Інфраструктурний dry run завершився помилкою.",
  }),
  deep_research_synthesis: Object.freeze({
    // Два послідовні виклики Claude, перший — із власним веб-пошуком по
    // d_-блоках; 90 хв стелі вистачає з запасом, heartbeat воркера продовжує
    // lease кожну хвилину.
    executable: join(REPO_ROOT, "agents/scripts/deep-research.sh"),
    args: ["--stage", "synthesis"],
    timeoutMs: 5_400_000,
    passPayload: true,
    successStatus: "ok",
    successNote: "Синтез глибокого дослідження завершено на M1.",
    failureNote: "Синтез глибокого дослідження завершився помилкою.",
  }),
  telegram_update: Object.freeze({
    executable: join(REPO_ROOT, "agents/scripts/telegram-bot.py"),
    args: ["--process-update"],
    timeoutMs: 1_900_000,
    passPayload: true,
    successStatus: "ok",
    successNote: "Telegram update успішно оброблено на M1.",
    failureNote: "Обробка Telegram update на M1 завершилася помилкою.",
  }),
  telegram_nudge: Object.freeze({
    executable: join(REPO_ROOT, "agents/scripts/telegram-bot.py"),
    args: ["--nudge"],
    timeoutMs: 60_000,
    passPayload: false,
    successStatus: "ok",
    successNote: "Перевірку нагадування Telegram виконано.",
    failureNote: "Перевірка нагадування Telegram завершилася помилкою.",
  }),
});

/**
 * @param {string} jobId
 * @param {string} [jobType]
 * @param {Date} [date]
 * @returns {string}
 */
export function buildRunId(jobId, jobType = "infrastructure_dry_run", date = new Date()) {
  const timestamp = date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const jobSlug = jobType.replaceAll("_", "-").replace(/[^a-z0-9-]/gi, "-");
  return `${timestamp}-local-${jobSlug}-${jobId.slice(0, 8)}`;
}

/**
 * @param {number} attempt
 * @returns {number}
 */
export function backoffFor(attempt) {
  const index = Math.min(Math.max(attempt, 1), RECONNECT_BACKOFF_MS.length) - 1;
  return RECONNECT_BACKOFF_MS[index];
}

/**
 * @param {Job} job
 * @returns {JobHandler & {stdin: string | null}}
 */
export function commandForJob(job) {
  const handler = JOB_HANDLERS[/** @type {keyof typeof JOB_HANDLERS} */ (job.type)];
  if (!handler) throw new Error(`Непідтримуваний тип job: ${job.type}`);
  return {
    ...handler,
    stdin: handler.passPayload ? JSON.stringify(job.payload ?? {}) : null,
  };
}

/**
 * @param {Job} job
 * @returns {{idea_id?: string}}
 */
function publicJobMeta(job) {
  if (job.type !== "deep_research_synthesis") return {};
  const ideaId = /** @type {{idea_id?: unknown} | null | undefined} */ (job.payload)?.idea_id;
  return typeof ideaId === "string" ? { idea_id: ideaId } : {};
}

/** @param {string} message */
function log(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

/**
 * @param {string} current
 * @param {Buffer | string} chunk
 * @returns {string}
 */
function appendLimited(current, chunk) {
  const next = current + chunk.toString();
  return next.length <= OUTPUT_LIMIT ? next : next.slice(next.length - OUTPUT_LIMIT);
}

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {{stdin: string | null, timeoutMs: number, extraEnv?: Record<string, string>}} options
 * @returns {Promise<{exitCode: number | null, stdout: string, stderr: string, error: string | null, timedOut: boolean}>}
 */
function runProcess(executable, args, { stdin, timeoutMs, extraEnv }) {
  return new Promise((resolveProcess) => {
    const child = spawn(executable, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...extraEnv },
      shell: false,
      stdio: [stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // stdio: [.., "pipe", "pipe"] завжди дає non-null stdout/stderr; @types/node
    // типізує їх ширше (readonly stream | null), бо не бачить наш конкретний виклик.
    /** @type {import("node:stream").Readable} */ (child.stdout).on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    /** @type {import("node:stream").Readable} */ (child.stderr).on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });

    if (child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolveProcess({ exitCode: null, stdout, stderr, error: error.message, timedOut });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolveProcess({ exitCode, stdout, stderr, error: null, timedOut });
    });
  });
}

/** @param {{supabase: SupabaseWorkerClient, workerId: string}} options */
export function createJobWorker({ supabase, workerId }) {
  let draining = false;
  let drainRequested = false;

  /**
   * @param {Job} job
   * @param {JobsUpdateFields} fields
   * @returns {Promise<boolean>}
   */
  async function updateClaim(job, fields) {
    const { data, error } = await /** @type {JobsQueryBuilder} */ (supabase.from("jobs"))
      .update(fields)
      .eq("id", job.id)
      .eq("status", "running")
      .eq("claim_token", job.claim_token)
      .select("id");
    if (error) throw error;
    return Boolean(data?.length);
  }

  /**
   * @param {Job} job
   * @param {"succeeded" | "failed"} status
   * @param {string | null} runId
   * @param {string | null} [errorMessage]
   */
  async function finishJob(job, status, runId, errorMessage = null) {
    const updated = await updateClaim(job, {
      status,
      run_id: runId,
      finished_at: new Date().toISOString(),
      lease_expires_at: null,
      last_error: errorMessage,
    });
    if (!updated) throw new Error(`Lease job ${job.id} більше не належить ${workerId}`);
  }

  /** @param {Job} job */
  async function executeJob(job) {
    let command;
    try {
      command = commandForJob(job);
    } catch (error) {
      await finishJob(job, "failed", null, error.message);
      log(`job=${job.id} failed: ${error.message}`);
      return;
    }

    const runId = buildRunId(job.id, job.type);
    const startedAt = new Date();
    const { error: runStartError } = await /** @type {RunsQueryBuilder} */ (supabase.from("runs")).insert({
      run_id: runId,
      job: job.type.replaceAll("_", "-"),
      provider: "local",
      started_at: startedAt.toISOString(),
      status: "running",
      meta: {
        job_id: job.id,
        worker_id: workerId,
        attempt: job.attempt_count,
        ...publicJobMeta(job),
      },
    });
    if (runStartError) {
      await finishJob(job, "failed", null, `Не вдалося створити run: ${runStartError.message}`);
      throw runStartError;
    }

    const attached = await updateClaim(job, { run_id: runId });
    if (!attached) throw new Error(`Не вдалося прив'язати run ${runId} до job ${job.id}`);

    const heartbeat = setInterval(async () => {
      try {
        await updateClaim(job, {
          lease_expires_at: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
        });
      } catch (error) {
        log(`job=${job.id} heartbeat failed: ${error.message}`);
      }
    }, HEARTBEAT_MS);

    log(`job=${job.id} run=${runId} started type=${job.type}`);
    // run_id передається скрипту через середовище: рядки, які він пише в БД
    // (criteria_verdicts, research_reports), мають посилатись на цей прогін.
    const result = await runProcess(command.executable, command.args, {
      ...command,
      extraEnv: { IDEAS_SCOUT_JOB_RUN_ID: runId },
    });
    clearInterval(heartbeat);

    const durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
    const success = result.exitCode === 0 && !result.error && !result.timedOut;
    const errorMessage = success
      ? null
      : result.error || (result.timedOut ? "Процес перевищив таймаут" : `Exit code ${result.exitCode}`);
    const runStatus = success ? command.successStatus : "error";
    const errors = errorMessage ? [errorMessage] : [];

    const { error: runFinishError } = await /** @type {RunsQueryBuilder} */ (supabase.from("runs"))
      .update({
        finished_at: new Date().toISOString(),
        status: runStatus,
        errors,
        notes: success ? command.successNote : command.failureNote,
        meta: {
          job_id: job.id,
          worker_id: workerId,
          attempt: job.attempt_count,
          duration_s: durationSeconds,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
          exit_code: result.exitCode,
          timed_out: result.timedOut,
          ...publicJobMeta(job),
        },
      })
      .eq("run_id", runId);
    if (runFinishError) throw runFinishError;

    await finishJob(job, success ? "succeeded" : "failed", runId, errorMessage);
    log(`job=${job.id} run=${runId} finished status=${runStatus}`);
  }

  /** @returns {Promise<Job | null>} */
  async function claimNextJob() {
    const { data, error } = await supabase.rpc("claim_next_job", {
      p_worker_id: workerId,
      p_lease_seconds: LEASE_SECONDS,
    });
    if (error) throw error;
    return data?.[0] ?? null;
  }

  async function drain() {
    if (draining) {
      drainRequested = true;
      return;
    }
    draining = true;
    try {
      do {
        drainRequested = false;
        let job;
        while ((job = await claimNextJob())) {
          try {
            await executeJob(job);
          } catch (error) {
            log(`job=${job.id} worker error: ${error.message}`);
          }
        }
      } while (drainRequested);
    } catch (error) {
      log(`queue drain failed: ${error.message}`);
    } finally {
      draining = false;
    }
  }

  return { drain };
}

/**
 * @param {Object} options
 * @param {SupabaseRealtimeClient} options.supabase
 * @param {() => void} options.onEvent
 * @param {() => void} options.onFatal
 * @param {(message: string) => void} [options.emit]
 * @param {(fn: () => (void | Promise<void>), delay: number) => any} [options.setTimer]
 * @param {(timer: any) => void} [options.clearTimer]
 */
export function createRealtimeSupervisor({
  supabase,
  onEvent,
  onFatal,
  emit = log,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  /** @type {RealtimeChannel | null} */
  let channel = null;
  let reconnectAttempt = 0;
  // Продакшен-таймер (NodeJS.Timeout) і тестові фейки (довільний об'єкт-мітка)
  // мають несумісні форми — це навмисно pluggable-межа, тому any, а не unknown.
  /** @type {any} */
  let reconnectTimer = null;
  let stopping = false;

  function openChannel() {
    const own = supabase.channel("ideas-scout-job-worker");
    channel = own;
    own
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => onEvent())
      .subscribe((/** @type {string} */ status) => {
        emit(`realtime=${status}`);
        // Знесений канал теж віддає CLOSED. Без цієї перевірки власний teardown
        // читався б як розрив і планував ще один reconnect — по колу, назавжди.
        if (stopping || channel !== own) return;
        if (status === "SUBSCRIBED") {
          reconnectAttempt = 0;
          onEvent();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          scheduleReconnect();
        }
      });
  }

  function scheduleReconnect({ immediate = false } = {}) {
    if (stopping || reconnectTimer) return;
    reconnectAttempt += 1;
    if (reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
      // Клієнт Supabase не завжди відновлюється сам після втрати сокета; вихід
      // ненульовим кодом віддає підйом воркера launchd-у (KeepAlive) — це єдиний
      // шлях, який не лишає процес живим, але глухим до черги.
      emit(`fatal: realtime не піднявся за ${MAX_RECONNECT_ATTEMPTS} спроб — виходжу під рестарт launchd`);
      onFatal();
      return;
    }
    const delay = immediate ? 0 : backoffFor(reconnectAttempt);
    emit(`realtime reconnect #${reconnectAttempt} через ${delay} ms`);
    reconnectTimer = setTimer(async () => {
      reconnectTimer = null;
      if (stopping) return;
      const previous = channel;
      channel = null;
      try {
        if (previous) await supabase.removeChannel(previous);
      } catch (error) {
        emit(`realtime removeChannel failed: ${error.message}`);
      }
      openChannel();
      // Черга розбирається одразу, не чекаючи на SUBSCRIBED: події, що надійшли
      // поки канал лежав, Realtime не переграє.
      onEvent();
    }, delay);
  }

  return {
    start: openChannel,
    reconnectNow() {
      reconnectAttempt = 0;
      if (reconnectTimer) {
        clearTimer(reconnectTimer);
        reconnectTimer = null;
      }
      scheduleReconnect({ immediate: true });
    },
    async stop() {
      stopping = true;
      if (reconnectTimer) clearTimer(reconnectTimer);
      const previous = channel;
      channel = null;
      if (previous) await supabase.removeChannel(previous);
    },
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Потрібні SUPABASE_URL і SUPABASE_SERVICE_KEY");

  // Ліниве завантаження залишає чисті contract-тести доступними ще до `npm ci`;
  // production-worker однаково встановлює пакет через install-launchd.sh.
  const { createClient } = await import("@supabase/supabase-js");
  const workerId = `${hostname()}:${process.pid}`;
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Реальний SupabaseClient набагато складніший за SupabaseWorkerClient
  // (generic query-builder на весь публічний API); нам потрібен лише зріз,
  // яким користується воркер, тож звіряємо сумісність один раз тут.
  const worker = createJobWorker({ supabase: /** @type {SupabaseWorkerClient} */ (/** @type {unknown} */ (supabase)), workerId });

  // Маркер старту: лог — один append-only файл на всі життя процесу, тож без
  // нього `tail` змішує рядки нового воркера зі старим і перепідключення давно
  // померлого процесу читаються як поточні. doctor.sh рахує статистику від
  // останнього такого рядка.
  log(`worker started ${workerId}`);

  const realtime = createRealtimeSupervisor({
    supabase: /** @type {SupabaseRealtimeClient} */ (/** @type {unknown} */ (supabase)),
    onEvent: () => void worker.drain(),
    onFatal: () => process.exit(1),
  });
  realtime.start();

  const safetySweep = setInterval(() => void worker.drain(), SAFETY_SWEEP_MS);

  let lastTick = Date.now();
  const watchdog = setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap < WAKE_GAP_MS) return;
    log(`wake після ~${Math.round(gap / 1000)} с простою — перепідключаю realtime`);
    realtime.reconnectNow();
  }, WATCHDOG_MS);

  const shutdown = async (/** @type {string} */ signal) => {
    log(`received ${signal}, stopping`);
    clearInterval(safetySweep);
    clearInterval(watchdog);
    await realtime.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((error) => {
    log(`fatal: ${error.message}`);
    process.exit(1);
  });
}
