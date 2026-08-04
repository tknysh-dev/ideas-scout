// Розбір блоба зі звітами зовнішніх моделей, який власник вставляє на порталі,
// і санітизація їхнього вмісту перед записом у базу. Модуль навмисно без IO —
// його покриває node --test (deep-research-reports.test.mts).
//
// Санітизація дзеркалить agents/scripts/deep-research.py (sanitize_criteria,
// sanitize_evidence, sanitize_competitors): звіт зовнішньої моделі — недовірені
// дані, тому в базу йдуть лише значення з білих списків, а вільний текст — з
// обрізанням довжини. Розсинхрон із Python означав би, що портал пропустить те,
// що синтез потім відкине (або навпаки).

import {
  BASE_CRITERIA_KEYS_BY_TRACK,
  DEEP_RESEARCH_KEYS,
} from "./deep-research-prompt.ts";

export const SEARCH_UNAVAILABLE = "SEARCH UNAVAILABLE";

export const VERDICTS = new Set([
  "passed",
  "failed",
  "owner",
  "skipped",
  "not_applicable",
  "noted",
]);
export const LIVENESS = new Set(["active", "stale", "dead"]);

const MAX_REPORT_MD = 200_000;
const MAX_LABEL = 100;
const MAX_MODEL = 200;
const MAX_EVIDENCE = 20;
const MAX_COMPETITORS = 40;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface EvidenceEntry {
  url: string;
  published_date?: string;
  quote?: string;
}

export interface SanitizedCriterion {
  criterion_key: string;
  verdict: string;
  score: string | null;
  summary: string | null;
  detail: string | null;
  evidence: EvidenceEntry[];
}

export interface SanitizedCompetitor {
  name: string;
  url?: string;
  pricing?: string;
  liveness?: string;
  last_activity?: string;
  strengths?: string;
  weaknesses?: string;
  differentiation?: string;
  evidence: EvidenceEntry[];
}


function truncate(value: unknown, limit: number): string | null {
  return typeof value === "string" ? value.slice(0, limit) : null;
}

function plural(count: number, forms: [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${forms[0]}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${forms[1]}`;
  return `${count} ${forms[2]}`;
}

// Мітка провайдера потрапляє і в базу, і в заголовок вкладки, тому з неї
// вирізаємо керівні та невидимі символи: інакше один невидимий символ робить
// дві однакові на вигляд вкладки різними рядками таблиці.
export function sanitizeLabel(raw: unknown, limit = MAX_LABEL): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit)
    .trim();
}

export function sanitizeEvidence(raw: unknown): EvidenceEntry[] {
  if (!Array.isArray(raw)) return [];
  const result: EvidenceEntry[] = [];
  for (const item of raw.slice(0, MAX_EVIDENCE)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.url !== "string") continue;
    const entry: EvidenceEntry = { url: record.url.slice(0, 2000) };
    if (typeof record.published_date === "string" && ISO_DATE.test(record.published_date)) {
      entry.published_date = record.published_date;
    }
    if (typeof record.quote === "string") entry.quote = record.quote.slice(0, 1000);
    result.push(entry);
  }
  return result;
}

export function allowedCriteriaKeys(track: string): Set<string> | null {
  const base = BASE_CRITERIA_KEYS_BY_TRACK[track];
  if (!base) return null;
  return new Set<string>([...base, ...DEEP_RESEARCH_KEYS]);
}

export interface SanitizeCriteriaResult {
  criteria: SanitizedCriterion[];
  /** Скільки об'єктів відкинули (невідомий ключ, невідомий вердикт, сміття). */
  dropped: number;
}

export function sanitizeCriteria(raw: unknown, allowed: Set<string>): SanitizeCriteriaResult {
  if (!Array.isArray(raw)) return { criteria: [], dropped: 0 };
  // Ключ критерію унікальний у межах звіту (unique-ключ criteria_verdicts) —
  // повтор того самого ключа перезаписує попередній, як і в Python.
  const byKey = new Map<string, SanitizedCriterion>();
  let dropped = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      dropped += 1;
      continue;
    }
    const record = item as Record<string, unknown>;
    const key = record.criterion_key;
    const verdict = record.verdict;
    if (typeof key !== "string" || !allowed.has(key) || typeof verdict !== "string" || !VERDICTS.has(verdict)) {
      dropped += 1;
      continue;
    }
    byKey.set(key, {
      criterion_key: key,
      verdict,
      score: truncate(record.score, 100),
      summary: truncate(record.summary, 500),
      detail: truncate(record.detail, 5000),
      evidence: sanitizeEvidence(record.evidence),
    });
  }
  return { criteria: [...byKey.values()], dropped };
}

export function sanitizeCompetitors(raw: unknown): SanitizedCompetitor[] {
  if (!Array.isArray(raw)) return [];
  const result: SanitizedCompetitor[] = [];
  for (const item of raw.slice(0, MAX_COMPETITORS)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name.trim()) continue;
    const row: SanitizedCompetitor = { name: record.name.trim().slice(0, 300), evidence: [] };
    const url = truncate(record.url, 2000);
    if (url !== null) row.url = url;
    const pricing = truncate(record.pricing, 500);
    if (pricing !== null) row.pricing = pricing;
    const strengths = truncate(record.strengths, 2000);
    if (strengths !== null) row.strengths = strengths;
    const weaknesses = truncate(record.weaknesses, 2000);
    if (weaknesses !== null) row.weaknesses = weaknesses;
    const differentiation = truncate(record.differentiation, 2000);
    if (differentiation !== null) row.differentiation = differentiation;
    if (typeof record.liveness === "string" && LIVENESS.has(record.liveness)) {
      row.liveness = record.liveness;
    }
    if (typeof record.last_activity === "string" && ISO_DATE.test(record.last_activity)) {
      row.last_activity = record.last_activity;
    }
    row.evidence = sanitizeEvidence(record.evidence);
    result.push(row);
  }
  return result;
}

export interface JsonBlockResult {
  data: Record<string, unknown> | null;
  /** Скільки fenced-блоків ```json взагалі трапилось у тексті. */
  blocks: number;
}

/** Останній валідний fenced ```json-блок — той самий вибір, що в Python. */
export function extractJsonBlock(text: string): JsonBlockResult {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)].map((match) => match[1]);
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    try {
      const parsed: unknown = JSON.parse(blocks[index]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { data: parsed as Record<string, unknown>, blocks: blocks.length };
      }
    } catch {
      continue;
    }
  }
  return { data: null, blocks: blocks.length };
}

export type ReportStatus = "ok" | "prose" | "refused" | "empty";

export interface ParsedReport {
  provider: string;
  model: string | null;
  status: ReportStatus;
  /** Вербатим-текст відповіді — джерело правди для синтезу. */
  reportMd: string;
  criteria: SanitizedCriterion[];
  competitors: SanitizedCompetitor[];
  /** Чому звіт не дав структури — пояснення для власника, а не код помилки. */
  problem?: string;
  /** Мʼякі зауваження: розбір відбувся, але щось варто знати. */
  notes: string[];
}

export interface ReportInput {
  provider: string;
  model?: string | null;
  text: string;
}

export interface ParseReportsInput {
  track: string;
  reports: ReportInput[];
}

export interface ParseReportsResult {
  reports: ParsedReport[];
  /** Скільки звітів дійдуть до синтезу — зі структурою чи бодай прозою. */
  usableCount: number;
  error?: string;
}

// Відповідь однієї моделі. Раніше звіти різались із суцільного тексту по
// маркерах, які мала поставити сама модель, — і кожна невдача форматування
// коштувала цілого прогону. Тепер провайдера називає власник у формі, а текст
// приходить окремим полем, тож розбирати лишається тільки вміст.
export function parseReport(
  input: ReportInput,
  allowed: Set<string>,
): ParsedReport {
  const notes: string[] = [];
  const text = input.text.trim();
  const report: ParsedReport = {
    provider: sanitizeLabel(input.provider),
    model: sanitizeLabel(input.model, MAX_MODEL) || null,
    status: "ok",
    reportMd: text.slice(0, MAX_REPORT_MD),
    criteria: [],
    competitors: [],
    notes,
  };

  if (!text) {
    report.status = "empty";
    report.problem = "Поле порожнє — вставте сюди відповідь моделі.";
    return report;
  }

  if (new RegExp(`^\\s*${SEARCH_UNAVAILABLE}\\s*$`, "m").test(text)) {
    report.status = "refused";
    report.problem =
      "Модель відповіла SEARCH UNAVAILABLE — у неї не було живого веб-пошуку, тому вона " +
      "свідомо не стала відповідати з памʼяті. Це коректна відповідь: у синтез такий звіт " +
      "не піде, але слід про відмову збережеться.";
    return report;
  }

  // Звіт без придатного json-блоку більше не пропадає: прозу читає синтез, і
  // година роботи власника не згорає через одну кому. Втрачається лише
  // структура — вкладка цього провайдера лишиться без вердиктів по критеріях.
  const { data: json, blocks } = extractJsonBlock(text);
  if (!json) {
    report.status = "prose";
    report.problem =
      (blocks === 0
        ? "У відповіді немає машиночитного блоку ```json"
        : "Блок ```json є, але не розбирається як JSON") +
      " — звіт усе одно піде в синтез як текст, але окремої вкладки з вердиктами " +
      "по цій моделі не буде. Щоб вона зʼявилась, попросіть модель повторити " +
      "підсумковий блок одним шматком.";
    return report;
  }

  const { criteria, dropped } = sanitizeCriteria(json.criteria, allowed);
  report.criteria = criteria;
  report.competitors = sanitizeCompetitors(json.competitors);

  if (criteria.length === 0 && report.competitors.length === 0) {
    report.status = "prose";
    report.problem =
      "json-блок розібрався, але в ньому немає жодного критерію з відомим ключем і жодного " +
      "конкурента — схоже, модель відповіла за власною схемою. Текст піде в синтез, " +
      "структурованих вердиктів по цій моделі не буде.";
    return report;
  }

  if (dropped > 0) {
    notes.push(
      `${plural(dropped, ["запис", "записи", "записів"])} у json-блоці відкинуто: невідомий ` +
        "ключ критерію або вердикт поза переліком. Решта звіту збережеться.",
    );
  }
  if (criteria.length > 0 && criteria.length < allowed.size) {
    notes.push(
      `Модель оцінила ${plural(criteria.length, ["критерій", "критерії", "критерії"])} ` +
        `із ${allowed.size} — синтез зведе те, що є, але повнішу картину дала б повторна ` +
        "відповідь.",
    );
  }
  return report;
}

export function parseReports(input: ParseReportsInput): ParseReportsResult {
  const allowed = allowedCriteriaKeys(input.track);
  if (!allowed) {
    return { reports: [], usableCount: 0, error: `Трек «${input.track}» не має чек-листа критеріїв.` };
  }

  const seen = new Set<string>();
  for (const entry of input.reports) {
    const provider = sanitizeLabel(entry.provider);
    if (!provider) {
      return { reports: [], usableCount: 0, error: "У кожної відповіді має бути обраний провайдер." };
    }
    // Провайдер — частина ключа в базі, тож два звіти від одного сервісу
    // перезаписали б один одного.
    if (seen.has(provider)) {
      return {
        reports: [],
        usableCount: 0,
        error: `Провайдер «${provider}» обраний двічі — одна консолідація приймає по одному звіту від кожного.`,
      };
    }
    seen.add(provider);
  }

  const reports = input.reports.map((entry) => parseReport(entry, allowed));
  return {
    reports,
    usableCount: reports.filter((r) => r.status === "ok" || r.status === "prose").length,
  };
}
