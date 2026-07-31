import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORKER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(WORKER_DIR, "../..");
const LEASE_SECONDS = 300;
const HEARTBEAT_MS = 60_000;
const SAFETY_SWEEP_MS = 300_000;
const OUTPUT_LIMIT = 64 * 1024;

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
  deep_research: Object.freeze({
    executable: join(REPO_ROOT, "agents/scripts/deep-research.sh"),
    args: [],
    timeoutMs: 60_000,
    passPayload: true,
    successStatus: "dry_run",
    successNote: "Глибоке дослідження успішно виконало dry run на M1.",
    failureNote: "Dry run глибокого дослідження завершився помилкою.",
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

export function buildRunId(jobId, jobType = "infrastructure_dry_run", date = new Date()) {
  const timestamp = date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const jobSlug = jobType.replaceAll("_", "-").replace(/[^a-z0-9-]/gi, "-");
  return `${timestamp}-local-${jobSlug}-${jobId.slice(0, 8)}`;
}

export function commandForJob(job) {
  const handler = JOB_HANDLERS[job.type];
  if (!handler) throw new Error(`Непідтримуваний тип job: ${job.type}`);
  return {
    ...handler,
    stdin: handler.passPayload ? JSON.stringify(job.payload ?? {}) : null,
  };
}

function publicJobMeta(job) {
  if (job.type !== "deep_research") return {};
  const ideaId = job.payload?.idea_id;
  return typeof ideaId === "string" ? { idea_id: ideaId } : {};
}

function log(message) {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`);
}

function appendLimited(current, chunk) {
  const next = current + chunk.toString();
  return next.length <= OUTPUT_LIMIT ? next : next.slice(next.length - OUTPUT_LIMIT);
}

function runProcess(executable, args, { stdin, timeoutMs }) {
  return new Promise((resolveProcess) => {
    const child = spawn(executable, args, {
      cwd: REPO_ROOT,
      env: process.env,
      shell: false,
      stdio: [stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
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

export function createJobWorker({ supabase, workerId }) {
  let draining = false;
  let drainRequested = false;

  async function updateClaim(job, fields) {
    const { data, error } = await supabase
      .from("jobs")
      .update(fields)
      .eq("id", job.id)
      .eq("status", "running")
      .eq("claim_token", job.claim_token)
      .select("id");
    if (error) throw error;
    return Boolean(data?.length);
  }

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
    const { error: runStartError } = await supabase.from("runs").insert({
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
    const result = await runProcess(command.executable, command.args, command);
    clearInterval(heartbeat);

    const durationSeconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
    const success = result.exitCode === 0 && !result.error && !result.timedOut;
    const errorMessage = success
      ? null
      : result.error || (result.timedOut ? "Процес перевищив таймаут" : `Exit code ${result.exitCode}`);
    const runStatus = success ? command.successStatus : "error";
    const errors = errorMessage ? [errorMessage] : [];

    const { error: runFinishError } = await supabase
      .from("runs")
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
  const worker = createJobWorker({ supabase, workerId });

  const channel = supabase
    .channel("ideas-scout-job-worker")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "jobs" },
      () => void worker.drain(),
    )
    .subscribe((status) => {
      log(`realtime=${status}`);
      if (status === "SUBSCRIBED") void worker.drain();
    });

  const safetySweep = setInterval(() => void worker.drain(), SAFETY_SWEEP_MS);
  const shutdown = async (signal) => {
    log(`received ${signal}, stopping`);
    clearInterval(safetySweep);
    await supabase.removeChannel(channel);
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
