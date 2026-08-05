// Глибоке дослідження на сторінці ідеї: групування структурованих вердиктів,
// підписи до них і додаткові блоки. Джерело правди по блоках —
// agents/criteria/deep-research.md, по значеннях полів — shared/schema.sql.

import type {
  CompetitorRow,
  CriteriaVerdictRow,
  CriterionVerdict,
  SynthesisResolution,
} from "./types";
// Розширення ".ts" явно: плейн `node --test` резолвить лише файлові шляхи,
// без bundler-евристик tsconfig.
import { getChecklist, type CriterionSpec, type CriterionTone } from "./criteria.ts";

export type { CriterionTone };

export interface DeepBlockSpec {
  key: string;
  title: string;
  hint: string;
}

export const DEEP_BLOCKS: DeepBlockSpec[] = [
  { key: "d_demand", title: "Валідація попиту", hint: "Чи люди вже платять за альтернативи, а не лише скаржаться" },
  { key: "d_unit_econ", title: "Юніт-економіка", hint: "Скільки клієнтів потрібно до цільового доходу і за якою ціною" },
  { key: "d_channels", title: "Канали дистрибуції", hint: "Чи досяжна аудиторія органічно, без бюджету на рекламу" },
  { key: "d_graveyard", title: "Кладовище ніші", hint: "Мертві продукти ніші й причини їхньої смерті" },
  { key: "d_dependencies", title: "Ризики залежностей", hint: "Платформи й API, від яких залежить ідея" },
  { key: "d_mvp", title: "MVP-скоуп", hint: "Мінімальний обсяг до першого продажу" },
  { key: "d_legal", title: "Правові ризики і прецеденти", hint: "Позови проти схожих продуктів, IP, GDPR, ліцензії" },
];

// Підписи й кольорові токени тонів — тут, а не в компоненті, за конвенцією
// проєкту: усі такі словники живуть у lib (див. STATUS_META, REJECTION_META
// у lib/status.ts), щоб компонент не імпортував дані з іншого компонента.
export const TONE_META: Record<CriterionTone, { label: string; hint: string; token: string }> = {
  passed: { label: "Пройдено", hint: "Критерій виконано, зауважень немає.", token: "accepted" },
  failed: {
    label: "Провалено",
    hint: "Критерій не виконано — якщо він фатальний, це причина відхилити ідею.",
    token: "rejected",
  },
  owner: {
    label: "На рішення власника",
    hint: "Однозначного вердикту немає — рішення лишили за власником.",
    token: "approved_pending",
  },
  skipped: {
    label: "Не оцінювався",
    hint: "Даних для оцінки цього критерію не було або він не застосовується до цієї ідеї.",
    token: "transferred",
  },
  noted: {
    label: "Пройдено із застереженням",
    hint: "Вердикт не провальний, але є нюанс, який варто прочитати в поясненні нижче.",
    token: "analyzing",
  },
};

// Пігулка «моделі розійшлись» — не сам вердикт, а сигнал про розбіжність між
// моделями-дослідниками по конкретному критерію; фінальне рішення — у резолюції.
export const DISAGREEMENT_META = {
  label: "моделі розійшлись",
  hint: "Незалежні моделі дали різні вердикти по цьому критерію — як зведено розбіжність, дивіться в резолюції нижче.",
};

// Резолюція синтезу — службова позначка, не вердикт: песимістичний дефолт
// вартий тону провалу, решта лишається нейтральною.
export const RESOLUTION_TOKEN: Record<SynthesisResolution, string> = {
  consensus: "transferred",
  evidence: "analyzing",
  pessimistic_default: "rejected",
};

// Вердикт структурованого рядка → тон картки. Тони вже має чек-лист критеріїв,
// тож додаткові блоки малюються тими самими кольорами, що й базові.
export const VERDICT_TONE: Record<CriterionVerdict, CriterionTone> = {
  passed: "passed",
  failed: "failed",
  owner: "owner",
  skipped: "skipped",
  not_applicable: "skipped",
  noted: "noted",
};

export const RESOLUTION_META: Record<SynthesisResolution, { label: string; hint: string }> = {
  consensus: {
    label: "Моделі зійшлись",
    hint: "Незалежні моделі-дослідники дійшли одного висновку без суперечок.",
  },
  evidence: {
    label: "Вирішено перевіркою джерел",
    hint: "Моделі дали різні вердикти — перемогла та сторона, чиї джерела (посилання з датою) підтвердились при перевірці.",
  },
  pessimistic_default: {
    label: "Взято найгірший варіант",
    hint: "Розбіжність не вдалось розв'язати доказами — узято найсуворіший вердикт, щоб слабка ідея не пройшла непоміченою.",
  },
};

// Вступний рядок над плашками моделей — рендериться один раз на секцію
// (CriteriaAnalysis, DeepResearchBlocks), а не над кожним критерієм.
export const MODEL_VOTES_INTRO =
  "Нижче — як проголосувала кожна модель-дослідник і як зведено розбіжності.";

export const LIVENESS_META: Record<
  NonNullable<CompetitorRow["liveness"]>,
  { label: string; token: string }
> = {
  active: { label: "Живий", token: "accepted" },
  stale: { label: "Застиг", token: "approved_pending" },
  dead: { label: "Мертвий", token: "rejected" },
};

export interface EvidenceItem {
  url: string;
  published_date?: string;
  quote?: string;
}

// evidence приходить із jsonb — тип на межі БД невідомий, тож розбираємо руками.
export function parseEvidence(raw: unknown): EvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  const items: EvidenceItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.url !== "string") continue;
    items.push({
      url: record.url,
      published_date: typeof record.published_date === "string" ? record.published_date : undefined,
      quote: typeof record.quote === "string" ? record.quote : undefined,
    });
  }
  return items;
}

export interface CriterionVerdicts {
  synthesis: CriteriaVerdictRow | null;
  models: CriteriaVerdictRow[];
}

export interface DeepResearchData {
  byKey: Map<string, CriterionVerdicts>;
  providers: string[];
  /** Чи розійшлись моделі бодай в одному критерії — сигнал для заголовка. */
  hasDisagreement: boolean;
}

export function groupVerdicts(rows: CriteriaVerdictRow[]): DeepResearchData {
  const byKey = new Map<string, CriterionVerdicts>();
  const providers = new Set<string>();

  for (const row of rows) {
    const entry = byKey.get(row.criterion_key) ?? { synthesis: null, models: [] };
    if (row.kind === "synthesis") {
      entry.synthesis = row;
    } else {
      entry.models.push(row);
      providers.add(row.provider);
    }
    byKey.set(row.criterion_key, entry);
  }

  for (const entry of byKey.values()) {
    entry.models.sort((a, b) => a.provider.localeCompare(b.provider));
  }

  const hasDisagreement = [...byKey.values()].some(
    (entry) => new Set(entry.models.map((m) => m.verdict)).size > 1,
  );

  return { byKey, providers: [...providers].sort(), hasDisagreement };
}

interface ProviderVerdictItem {
  key: string;
  title: string;
  row: CriteriaVerdictRow;
}

export interface ProviderGroup {
  provider: string;
  /** Конкретна модель сервісу — щоб було видно, чим саме зроблено цей прогін. */
  model: string | null;
  items: ProviderVerdictItem[];
}

function criterionTitle(checklist: CriterionSpec[] | undefined, key: string): string {
  const deepBlock = DEEP_BLOCKS.find((block) => block.key === key);
  if (deepBlock) return deepBlock.title;
  const spec = checklist?.find((item) => String(item.n) === key);
  return spec?.title ?? `Критерій ${key}`;
}

// Базові критерії йдуть за номером, d_-блоки — одразу після них, у порядку
// DEEP_BLOCKS: так вкладка моделі читається в тому ж порядку, що й
// консолідований блок вище.
function criterionOrder(key: string): number {
  const deepIndex = DEEP_BLOCKS.findIndex((block) => block.key === key);
  if (deepIndex !== -1) return 1000 + deepIndex;
  const n = Number(key);
  return Number.isFinite(n) ? n : 2000;
}

// Групування вердиктів «за провайдером» (для табів на сторінці ідеї) — на
// відміну від groupVerdicts (за критерієм, для консолідованого блоку).
export function groupByProvider(rows: CriteriaVerdictRow[], track: string): ProviderGroup[] {
  const checklist = getChecklist(track);
  const byProvider = new Map<string, { model: string | null; items: ProviderVerdictItem[] }>();

  for (const row of rows) {
    if (row.kind !== "model") continue;
    const entry = byProvider.get(row.provider) ?? { model: null, items: [] };
    entry.model = entry.model ?? row.model ?? null;
    entry.items.push({ key: row.criterion_key, title: criterionTitle(checklist, row.criterion_key), row });
    byProvider.set(row.provider, entry);
  }

  return [...byProvider.entries()]
    .map(([provider, entry]) => ({
      provider,
      model: entry.model,
      items: entry.items.sort((a, b) => criterionOrder(a.key) - criterionOrder(b.key)),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}
