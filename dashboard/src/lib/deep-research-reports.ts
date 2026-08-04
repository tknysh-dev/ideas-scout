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

export const REPORT_START_MARK = "DEEP RESEARCH REPORT START";
export const REPORT_END_MARK = "DEEP RESEARCH REPORT END";
export const SEARCH_UNAVAILABLE = "SEARCH UNAVAILABLE";
export const RESEARCHER_LABEL_PLACEHOLDER = "{{RESEARCHER_LABEL}}";
export const RESEARCHER_MODEL_PLACEHOLDER = "{{RESEARCHER_MODEL}}";

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

/**
 * `ok` — звіт піде в базу і в синтез; `refused` — модель чесно відмовилась
 * (SEARCH UNAVAILABLE), рядок зберігається як слід відмови; `invalid` —
 * маркери є, але машиночитної частини немає; `foreign` — звіт про іншу ідею,
 * у базу не потрапляє взагалі.
 */
export type ReportStatus = "ok" | "refused" | "invalid" | "foreign";

export interface ParsedReport {
  label: string;
  /** Конкретна модель сервісу — з маркера, інакше з самоназви у звіті. */
  model: string | null;
  status: ReportStatus;
  /** Вербатим текст звіту без маркерів — джерело правди для синтезу. */
  reportMd: string;
  criteria: SanitizedCriterion[];
  competitors: SanitizedCompetitor[];
  /** Чому звіт не годиться — пояснення для власника, а не код помилки. */
  problem?: string;
  /** Мʼякі зауваження: розбір відбувся, але щось варто знати. */
  notes: string[];
  markerIdeaId: string | null;
}

export interface ParseReportsInput {
  ideaId: string;
  track: string;
  blob: string;
}

export interface ParseReportsResult {
  reports: ParsedReport[];
  /** Скільки звітів придатні до консолідації (status === 'ok'). */
  validCount: number;
  /** Помилка рівня всього блоба — коли розбирати нічого. */
  error?: string;
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

interface MarkerLine {
  kind: "start" | "end";
  label: string;
  model: string | null;
  ideaId: string | null;
}

// Маркер приймаємо трохи вільніше, ніж він описаний у промпті: моделі люблять
// загортати його в бектики або міняти кількість знаків «=». Жорсткою лишається
// тільки сама фраза маркера.
function readMarker(line: string): MarkerLine | null {
  const trimmed = line.trim().replace(/^[`\s]+/, "").replace(/[`\s]+$/, "");
  if (!trimmed.startsWith("=")) return null;
  const inner = trimmed.replace(/^=+\s*/, "").replace(/\s*=+$/, "");
  const parts = inner.split("|").map((part) => part.trim());
  const head = parts[0].toUpperCase();
  if (head === REPORT_END_MARK) return { kind: "end", label: "", model: null, ideaId: null };
  if (head !== REPORT_START_MARK) return null;
  // Проміжні поля між міткою та id — це модель. Промпт, згенерований до появи
  // моделі в маркері, дає три частини; читаємо і такий, щоб старий скопійований
  // текст не ламався мовчки.
  if (parts.length >= 4) {
    return {
      kind: "start",
      label: parts[1] ?? "",
      model: parts.slice(2, -1).join(" | ") || null,
      ideaId: parts[parts.length - 1] || null,
    };
  }
  if (parts.length === 3) {
    return { kind: "start", label: parts[1] ?? "", model: null, ideaId: parts[2] || null };
  }
  return { kind: "start", label: parts[1] ?? "", model: null, ideaId: null };
}

interface Segment {
  marker: MarkerLine;
  body: string;
  terminated: boolean;
}

function splitSegments(blob: string): Segment[] {
  const lines = blob.split(/\r?\n/);
  const markers = lines.map(readMarker);
  const segments: Segment[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const marker = markers[i];
    if (marker?.kind !== "start") continue;
    let end = lines.length;
    let terminated = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (markers[j]?.kind === "end") {
        end = j;
        terminated = true;
        break;
      }
      if (markers[j]?.kind === "start") {
        end = j;
        break;
      }
    }
    segments.push({ marker, body: lines.slice(i + 1, end).join("\n").trim(), terminated });
    i = terminated ? end : end - 1;
  }

  return segments;
}

function resolveLabel(
  marker: MarkerLine,
  json: Record<string, unknown> | null,
  index: number,
): string {
  const fromMarker = sanitizeLabel(marker.label);
  if (fromMarker && fromMarker !== RESEARCHER_LABEL_PLACEHOLDER) return fromMarker;
  const fromJson = sanitizeLabel(json?.researcher);
  if (fromJson && fromJson !== RESEARCHER_LABEL_PLACEHOLDER) return fromJson;
  const fromModel = sanitizeLabel(json?.self_reported_model);
  if (fromModel) return fromModel;
  return `unknown-${index}`;
}

// Модель із маркера авторитетніша за самоназву: власник знає, у якому вікні
// працював, а моделі часто не знають власної версії й вигадують її.
function resolveModel(marker: MarkerLine, json: Record<string, unknown> | null): string | null {
  for (const raw of [marker.model, json?.researcher_model, json?.self_reported_model]) {
    const value = sanitizeLabel(raw, MAX_MODEL);
    if (value && value !== RESEARCHER_MODEL_PLACEHOLDER) return value;
  }
  return null;
}

export function parseReportsBlob(input: ParseReportsInput): ParseReportsResult {
  const allowed = allowedCriteriaKeys(input.track);
  if (!allowed) {
    return { reports: [], validCount: 0, error: `Трек «${input.track}» не має чек-листа критеріїв.` };
  }

  const segments = splitSegments(input.blob);
  if (segments.length === 0) {
    return {
      reports: [],
      validCount: 0,
      error:
        input.blob.trim().length === 0
          ? "Поле порожнє — вставте сюди відповіді моделей."
          : `У вставленому тексті немає жодного рядка «===== ${REPORT_START_MARK} | … | … =====». ` +
            "Портал розрізняє звіти лише за цими маркерами, тому копіювати відповідь треба " +
            "цілком, разом із першим і останнім рядками. Якщо модель їх не поставила — " +
            "допишіть їх руками навколо її тексту.",
    };
  }

  const reports: ParsedReport[] = [];
  const usedLabels = new Set<string>();

  segments.forEach((segment, index) => {
    const notes: string[] = [];
    if (!segment.terminated) {
      notes.push(
        `Модель не поставила закривальний рядок «===== ${REPORT_END_MARK} =====», ` +
          "тому за звіт узято весь текст до наступного маркера.",
      );
    }

    const { data: json, blocks } = extractJsonBlock(segment.body);
    let label = resolveLabel(segment.marker, json, index + 1);
    if (usedLabels.has(label)) {
      let suffix = 2;
      while (usedLabels.has(`${label} (${suffix})`)) suffix += 1;
      const unique = `${label} (${suffix})`;
      notes.push(
        `Мітка «${label}» вже зайнята іншим звітом у цьому ж тексті, тому цей збережеться ` +
          `як «${unique}». Якщо це справді одна модель — приберіть зайвий звіт і вставте текст знову.`,
      );
      label = unique;
    }
    usedLabels.add(label);

    const model = resolveModel(segment.marker, json);
    const report: ParsedReport = {
      label,
      model,
      status: "ok",
      reportMd: segment.body.slice(0, MAX_REPORT_MD),
      criteria: [],
      competitors: [],
      notes,
      markerIdeaId: segment.marker.ideaId,
    };

    if (segment.marker.ideaId && segment.marker.ideaId !== input.ideaId) {
      report.status = "foreign";
      report.problem =
        `У маркері стоїть ідея «${segment.marker.ideaId}», а ця сторінка — «${input.ideaId}». ` +
        "Схоже, у текст потрапила відповідь для іншої ідеї: цей звіт не буде записано. " +
        "Перенесіть його на сторінку тієї ідеї.";
      reports.push(report);
      return;
    }
    if (!segment.marker.ideaId) {
      notes.push(
        `У маркері немає ID ідеї — звіт віднесено до ${input.ideaId}, бо саме її сторінка відкрита.`,
      );
    }

    if (new RegExp(`^\\s*${SEARCH_UNAVAILABLE}\\s*$`, "m").test(segment.body)) {
      report.status = "refused";
      report.problem =
        "Модель відповіла SEARCH UNAVAILABLE — у неї не було живого веб-пошуку, тому вона " +
        "свідомо не стала відповідати з памʼяті. Це коректна відповідь: у синтез такий звіт " +
        "не піде, але слід про відмову збережеться.";
      reports.push(report);
      return;
    }

    if (!json) {
      report.status = "invalid";
      report.problem =
        blocks === 0
          ? "У звіті немає машиночитного блоку ```json — саме з нього портал бере вердикти " +
            "й конкурентів. Найчастіше причина в тому, що при копіюванні загубився хвіст " +
            "відповіді: попросіть модель повторити підсумковий json-блок і вставте текст знову."
          : "Блок ```json у звіті є, але він не розбирається як JSON — найчастіше через " +
            "обрив на середині або зайвий текст усередині блоку. Попросіть модель " +
            "повторити блок цілком і одним шматком.";
      reports.push(report);
      return;
    }

    const { criteria, dropped } = sanitizeCriteria(json.criteria, allowed);
    const competitors = sanitizeCompetitors(json.competitors);
    report.criteria = criteria;
    report.competitors = competitors;

    if (criteria.length === 0 && competitors.length === 0) {
      report.status = "invalid";
      report.problem =
        "json-блок розібрався, але в ньому немає жодного критерію з відомим ключем і жодного " +
        "конкурента. Схоже, модель відповіла за власною схемою: ключі критеріїв мають бути " +
        `рівно «${[...allowed].join("», «")}», а вердикти — одним зі значень passed / failed / ` +
        "owner / noted / not_applicable / skipped.";
      reports.push(report);
      return;
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

    reports.push(report);
  });

  return { reports, validCount: reports.filter((r) => r.status === "ok").length };
}
