// Глибоке дослідження на сторінці ідеї: групування структурованих вердиктів,
// підписи до них і додаткові блоки. Джерело правди по блоках —
// agents/criteria/deep-research.md, по значеннях полів — shared/schema.sql.

import type {
  CompetitorRow,
  CriteriaVerdictRow,
  CriterionVerdict,
  SynthesisResolution,
} from "./types";
import type { CriterionTone } from "./criteria";

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
export const TONE_META: Record<CriterionTone, { label: string; token: string }> = {
  passed: { label: "Пройдено", token: "accepted" },
  failed: { label: "Провалено", token: "rejected" },
  owner: { label: "На рішення власника", token: "approved_pending" },
  skipped: { label: "Не оцінювався", token: "transferred" },
  noted: { label: "Із зауваженням", token: "analyzing" },
};

// Резолюція синтезу — службова позначка, не вердикт: песимістичний дефолт
// вартий тону провалу, решта лишається нейтральною.
export const RESOLUTION_TOKEN: Record<SynthesisResolution, string> = {
  consensus: "transferred",
  evidence: "analyzing",
  cross_exam: "analyzing",
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
    label: "консенсус",
    hint: "Незалежні моделі зійшлись у вердикті",
  },
  evidence: {
    label: "за доказами",
    hint: "Моделі розійшлись — перемогла сторона з перевіреними датованими джерелами",
  },
  cross_exam: {
    label: "після крос-допиту",
    hint: "Спір вирішив окремий арбітр, який оцінював силу доказів обох сторін",
  },
  pessimistic_default: {
    label: "песимістично",
    hint: "Докази не розв'язали суперечку — узято найгірший вердикт, щоб слабка ідея не пройшла тихо",
  },
};

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
