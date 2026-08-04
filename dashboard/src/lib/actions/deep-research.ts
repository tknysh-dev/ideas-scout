"use server";

import { revalidatePath } from "next/cache";
import { buildDeepResearchPrompt } from "@/lib/deep-research-prompt.server";
import {
  parseReports,
  type ParsedReport,
  type ReportInput,
  type ReportStatus,
} from "@/lib/deep-research-reports";
import { ownerLogin } from "@/lib/owner.server";
import { OWNER_DECIDABLE_STATUSES } from "@/lib/status";
import { getServiceClient } from "@/lib/supabase/service";
import type { IdeaStatus } from "@/lib/types";

const IDEA_ID_RE = /^[A-Z]{2,10}-\d{3,8}$/;

// Тіло Server Action за замовчуванням обмежене мегабайтом. Пʼять звітів по три
// тисячі слів у цю межу вкладаються з великим запасом, тому все, що більше, —
// майже напевно випадково вставлений сторонній текст, і краще сказати про це
// одразу, ніж отримати обрив запиту без пояснення.
const MAX_BLOB_CHARS = 800_000;

// Статус рядка research_reports: відмова моделі — не помилка порталу, тому
// SEARCH UNAVAILABLE зберігається як 'skipped', а не 'error'.
// Звіт без структури все одно йде в синтез як текст, тому для бази він 'ok':
// саме за цим статусом deep-research.py відбирає, що читати. Відмова моделі —
// не поломка порталу, тому 'skipped'.
const REPORT_ROW_STATUS: Record<Exclude<ReportStatus, "empty">, string> = {
  ok: "ok",
  prose: "ok",
  refused: "skipped",
};

export interface DeepResearchPromptActionResult {
  prompt?: string;
  error?: string;
}

/** Підсумок одного звіту для показу власнику ДО будь-якого запису в базу. */
export interface ReportSummary {
  provider: string;
  status: ReportStatus;
  model: string | null;
  criteriaCount: number;
  competitorsCount: number;
  problem?: string;
  notes: string[];
}

export interface PreviewReportsResult {
  error?: string;
  reports?: ReportSummary[];
  validCount?: number;
}

export interface CommitReportsResult {
  error?: string;
  jobId?: string;
  alreadyQueued?: boolean;
  savedCount?: number;
  refusedCount?: number;
  verdictCount?: number;
}

interface LoadedIdea {
  error?: string;
  track?: string;
}

async function loadResearchableIdea(ideaId: string): Promise<LoadedIdea> {
  if (!IDEA_ID_RE.test(ideaId)) return { error: "Некоректний ID ідеї." };

  const supabase = getServiceClient();
  if (!supabase) return { error: "Немає доступу до бази." };

  // ID з клієнта не довіряємо: кнопка може бути видима на старому рендері, а
  // Server Action доступний прямим POST — статус перечитуємо тут.
  const { data: idea, error } = await supabase
    .from("ideas")
    .select("id,status,track")
    .eq("id", ideaId)
    .maybeSingle();
  if (error) return { error: `Не вдалося перевірити ідею: ${error.message}` };
  if (!idea) return { error: "Ідею не знайдено." };
  if (!OWNER_DECIDABLE_STATUSES.includes(idea.status as IdeaStatus)) {
    return { error: "Глибоке дослідження доступне після первинної оцінки ідеї." };
  }
  return { track: idea.track as string };
}

// Промпт однаковий для всіх провайдерів: чия це відповідь, власник позначає
// вже при консолідації, коли вставляє її в поле відповідного провайдера.
export async function fetchDeepResearchPrompt(
  ideaId: string,
): Promise<DeepResearchPromptActionResult> {
  const owner = await ownerLogin();
  if (owner.error) return { error: owner.error };

  const idea = await loadResearchableIdea(ideaId);
  if (idea.error) return { error: idea.error };

  return buildDeepResearchPrompt(ideaId);
}

function summarize(report: ParsedReport): ReportSummary {
  return {
    provider: report.provider,
    status: report.status,
    model: report.model,
    criteriaCount: report.criteria.length,
    competitorsCount: report.competitors.length,
    problem: report.problem,
    notes: report.notes,
  };
}

function checkReports(reports: unknown): string | null {
  if (!Array.isArray(reports) || reports.length === 0) {
    return "Додайте хоча б одну відповідь моделі.";
  }
  const total = reports.reduce(
    (sum, entry) => sum + (typeof entry?.text === "string" ? entry.text.length : 0),
    0,
  );
  if (total > MAX_BLOB_CHARS) {
    return (
      `Вставлені відповіді разом завеликі (${total.toLocaleString("uk-UA")} символів). ` +
      "Портал приймає до 800 тисяч — це приблизно вдесятеро більше за пʼять повних звітів. " +
      "Схоже, разом зі звітами скопіювалось щось стороннє."
    );
  }
  return null;
}

export async function previewDeepResearchReports(
  ideaId: string,
  reports: ReportInput[],
): Promise<PreviewReportsResult> {
  const owner = await ownerLogin();
  if (owner.error) return { error: owner.error };

  const inputError = checkReports(reports);
  if (inputError) return { error: inputError };

  const idea = await loadResearchableIdea(ideaId);
  if (idea.error) return { error: idea.error };

  const parsed = parseReports({ track: idea.track!, reports });
  if (parsed.error) return { error: parsed.error };
  return { reports: parsed.reports.map(summarize), validCount: parsed.usableCount };
}

export async function commitDeepResearchReports(
  ideaId: string,
  reports: ReportInput[],
): Promise<CommitReportsResult> {
  const owner = await ownerLogin();
  if (owner.error) return { error: owner.error };

  const inputError = checkReports(reports);
  if (inputError) return { error: inputError };

  const idea = await loadResearchableIdea(ideaId);
  if (idea.error) return { error: idea.error };

  // Розбираємо ще раз на сервері, а не приймаємо результат кроку 1 з клієнта:
  // між кроками нічого не заважає підмінити payload, а санітизація — єдиний
  // бар'єр між чужим текстом і базою.
  const parsed = parseReports({ track: idea.track!, reports });
  if (parsed.error) return { error: parsed.error };
  if (parsed.usableCount === 0) {
    return {
      error:
        "Серед розібраних звітів немає жодного придатного до консолідації — " +
        "синтезу не буде з чого зводити вердикт.",
    };
  }

  const supabase = getServiceClient();
  if (!supabase) return { error: "Немає доступу до бази." };

  const writable = parsed.reports.filter((report) => report.status !== "empty");

  // Повна заміна замість точкового upsert-у: інакше мітки попередньої
  // консолідації, яких цього разу не було, лишились би в базі привидами —
  // вкладка моделі, яку власник більше не питав, показувала б старий вердикт.
  // Витісняємо, а не видаляємо: старий прогін лишається в тих самих таблицях
  // під superseded_at, щоб було з чим порівняти новий (та сама модель у новій
  // версії). Часткові unique-індекси діють лише на superseded_at is null, тому
  // після цього UPDATE вставка нових рядків не конфліктує зі старими.
  // Рядків kind='synthesis' це не торкається: їх пише deep-research.py.
  const supersededAt = new Date().toISOString();
  const cleanup = await Promise.all([
    supabase
      .from("criteria_verdicts")
      .update({ superseded_at: supersededAt })
      .eq("idea_id", ideaId)
      .eq("stage", "deep")
      .eq("kind", "model")
      .is("superseded_at", null),
    supabase
      .from("research_reports")
      .update({ superseded_at: supersededAt })
      .eq("idea_id", ideaId)
      .eq("stage", "deep_criteria")
      .eq("kind", "model")
      .is("superseded_at", null),
  ]);
  for (const result of cleanup) {
    if (result.error) {
      return { error: `Не вдалося витіснити попередню консолідацію: ${result.error.message}` };
    }
  }

  const { error: reportsError } = await supabase.from("research_reports").insert(
    writable.map((report) => ({
      idea_id: ideaId,
      stage: "deep_criteria",
      kind: "model",
      provider: report.provider,
      model: report.model,
      status: REPORT_ROW_STATUS[report.status as Exclude<ReportStatus, "empty">],
      report_md: report.reportMd,
    })),
  );
  if (reportsError) return { error: `Не вдалося зберегти звіти: ${reportsError.message}` };

  const verdictRows = writable
    .filter((report) => report.status === "ok")
    .flatMap((report) =>
      report.criteria.map((criterion) => ({
        idea_id: ideaId,
        stage: "deep",
        kind: "model",
        provider: report.provider,
        model: report.model,
        criterion_key: criterion.criterion_key,
        verdict: criterion.verdict,
        score: criterion.score,
        summary: criterion.summary,
        detail: criterion.detail,
        evidence: criterion.evidence,
      })),
    );

  if (verdictRows.length > 0) {
    const { error: verdictsError } = await supabase.from("criteria_verdicts").insert(verdictRows);
    if (verdictsError) {
      return {
        error:
          `Звіти збережено, але структуровані вердикти — ні: ${verdictsError.message}. ` +
          "Спробуйте консолідацію ще раз.",
      };
    }
  }

  // Одна хвилина — вікно захисту від подвійного кліку; свідомий повтор
  // консолідації пізніше створить окремий job.
  const idempotencyKey = `deep-research-synthesis:${ideaId}:${Math.floor(Date.now() / 60_000)}`;
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .insert({
      type: "deep_research_synthesis",
      payload: { idea_id: ideaId },
      requested_by: `owner:dashboard:${owner.login}`,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  const saved = {
    savedCount: writable.filter((r) => r.status === "ok" || r.status === "prose").length,
    refusedCount: writable.filter((r) => r.status === "refused").length,
    verdictCount: verdictRows.length,
  };

  revalidatePath(`/ideas/${ideaId}`);
  revalidatePath("/runs");

  if (jobError?.code === "23505") {
    const { data: existing } = await supabase
      .from("jobs")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    return { ...saved, jobId: existing?.id, alreadyQueued: true };
  }
  if (jobError) {
    return {
      ...saved,
      error:
        `Звіти збережено, але синтез не поставився в чергу: ${jobError.message}. ` +
        "Повторіть консолідацію — щойно записані звіти просто витісняться тими самими.",
    };
  }

  return { ...saved, jobId: job.id };
}

/** Моделі, які вже використовувались для кожного провайдера. */
export type KnownModels = Record<string, string[]>;

// Список моделей ніде не взяти автоматично: API провайдерів віддають
// ідентифікатори API-моделей, а не назви з чат-інтерфейсу. Тому він
// самопідтримний — те, що власник вписав хоч раз, далі пропонується вибором.
export async function fetchKnownResearcherModels(): Promise<KnownModels> {
  const owner = await ownerLogin();
  if (owner.error) return {};

  const supabase = getServiceClient();
  if (!supabase) return {};

  const { data } = await supabase
    .from("research_reports")
    .select("provider,model")
    .not("model", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);

  const byProvider: KnownModels = {};
  for (const row of data ?? []) {
    const provider = String(row.provider ?? "").trim();
    const model = String(row.model ?? "").trim();
    if (!provider || !model) continue;
    const list = (byProvider[provider] ??= []);
    if (!list.includes(model)) list.push(model);
  }
  return byProvider;
}
