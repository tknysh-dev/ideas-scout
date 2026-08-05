// Чиста логіка server action'а deep-research.ts, винесена окремо, щоб її можна
// було накрити node --test без Supabase, auth і next/cache. Дзеркалить те, як
// уже розділені runner.sh/runner-lib.sh та telegram-webhook.ts.

import { OWNER_DECIDABLE_STATUSES } from "./status.ts";
import type { ParsedReport, ReportStatus } from "./deep-research-reports.ts";
import type { IdeaStatus } from "./types.ts";

const IDEA_ID_RE = /^[A-Z]{2,10}-\d{3,8}$/;

// Тіло Server Action за замовчуванням обмежене мегабайтом. Пʼять звітів по три
// тисячі слів у цю межу вкладаються з великим запасом, тому все, що більше, —
// майже напевно випадково вставлений сторонній текст, і краще сказати про це
// одразу, ніж отримати обрив запиту без пояснення.
export const MAX_BLOB_CHARS = 800_000;

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

export function isValidIdeaId(ideaId: string): boolean {
  return IDEA_ID_RE.test(ideaId);
}

export function isResearchableIdeaStatus(status: IdeaStatus): boolean {
  return OWNER_DECIDABLE_STATUSES.includes(status);
}

export function checkReportsInput(reports: unknown): string | null {
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

export function summarizeReport(report: ParsedReport): ReportSummary {
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

/** Звіти без розпізнаного вмісту (status === "empty") у базу не пишемо. */
export function selectWritableReports(reports: ParsedReport[]): ParsedReport[] {
  return reports.filter((report) => report.status !== "empty");
}

export function buildResearchReportRows(ideaId: string, writable: ParsedReport[]) {
  return writable.map((report) => ({
    idea_id: ideaId,
    stage: "deep_criteria",
    kind: "model",
    provider: report.provider,
    model: report.model,
    status: REPORT_ROW_STATUS[report.status as Exclude<ReportStatus, "empty">],
    report_md: report.reportMd,
  }));
}

export function buildVerdictRows(ideaId: string, writable: ParsedReport[]) {
  return writable
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
}

// Одна хвилина — вікно захисту від подвійного кліку; свідомий повтор
// консолідації пізніше створить окремий job.
export function buildSynthesisIdempotencyKey(ideaId: string, nowMs: number): string {
  return `deep-research-synthesis:${ideaId}:${Math.floor(nowMs / 60_000)}`;
}

export function computeSavedCounts(writable: ParsedReport[]): {
  savedCount: number;
  refusedCount: number;
} {
  return {
    savedCount: writable.filter((r) => r.status === "ok" || r.status === "prose").length,
    refusedCount: writable.filter((r) => r.status === "refused").length,
  };
}
