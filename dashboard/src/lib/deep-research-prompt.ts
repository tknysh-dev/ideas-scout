// Складання промпта глибокого дослідження, який власник вручну переносить у
// браузерні deep-research UI сторонніх моделей. Джерело правди по тексту —
// agents/prompts/deep-research-handoff.md. На відміну від build_idea_context()
// у agents/scripts/deep-research.py (внутрішній синтез, де Claude бачить сирі
// назви полів БД для призначення кодів відхилення), контекст тут навмисно
// олюднений: критерії й ідея приходять зовнішній моделі без згадок таксономії
// бази, шляхів репозиторію чи внутрішнього процесу.

import { splitCriteriaSection } from "./criteria.ts";
import type { Idea, SourceRow } from "./types";

export const DEEP_RESEARCH_KEYS = [
  "d_demand",
  "d_unit_econ",
  "d_channels",
  "d_graveyard",
  "d_dependencies",
  "d_mvp",
  "d_legal",
] as const;

// Номери базових критеріїв беруться з agents/criteria/criteria-<track>.md;
// трек поза цією мапою чек-листа не має, тому глибокого дослідження не буде.
export const BASE_CRITERIA_KEYS_BY_TRACK: Record<string, string[]> = {
  "passive-income": ["0", "1", "2", "3", "4", "5", "6"],
  "app-ideas": ["0", "1", "2", "3", "4", "5", "6", "7"],
};

export const HANDOFF_TEMPLATE_PATH = "agents/prompts/deep-research-handoff.md";
// Зовнішні брифи — переписані без внутрішньої кухні версії agents/criteria/*.md,
// призначені саме для вставки у вікна сторонніх моделей. Внутрішні документи
// лишаються джерелом правди для синтезу в agents/scripts/deep-research.py.
export const DEEP_CRITERIA_DOC_PATH = "agents/criteria/external/brief-deep-blocks.md";

// Ім'я файлу брифу не виводиться з назви треку: трек `app-ideas` лежить у
// brief-apps.md.
const CRITERIA_DOC_BY_TRACK: Record<string, string> = {
  "passive-income": "agents/criteria/external/brief-passive-income.md",
  "app-ideas": "agents/criteria/external/brief-apps.md",
};

export function criteriaDocPath(track: string) {
  const path = CRITERIA_DOC_BY_TRACK[track];
  if (!path) throw new Error(`Трек «${track}» не має чек-листа критеріїв`);
  return path;
}

export function isResearchableTrack(track: string) {
  return track in BASE_CRITERIA_KEYS_BY_TRACK;
}

export type IdeaContextInput = Pick<
  Idea,
  | "id"
  | "title"
  | "type"
  | "track"
  | "signal_type"
  | "claimed_revenue"
  | "mechanic_summary"
  | "monetization_hypothesis"
  | "body"
>;

export type SourceContextInput = Pick<
  SourceRow,
  "url" | "published_date" | "author_interest"
>;

// Категорія й сигнал заявки — людською мовою: зовнішня модель не має бачити
// внутрішню таксономію бази (назви треків і signal_type — це значення полів БД).
const TRACK_LABELS: Record<string, string> = {
  "passive-income": "механіки пасивного доходу",
  "app-ideas": "мобільні застосунки",
};

const SIGNAL_TYPE_LABELS: Record<IdeaContextInput["signal_type"], string> = {
  income_claim: "знахідка описує продукт, що вже приносить дохід",
  automation_report: "автор описує саморобну автоматизацію без платників",
};

// Розділ «Аналіз за критеріями» з тіла картки навмисно вирізається: дослідник
// не має бачити чужий вердикт, інакше його оцінка підлаштується під уже
// ухвалену (те саме анти-заякорення, що в deep-research.py).
export function buildIdeaContext(
  idea: IdeaContextInput,
  sources: SourceContextInput[],
): string {
  const { rest } = splitCriteriaSection(idea.body);
  const lines = [
    `- id: ${idea.id}, назва: ${idea.title}`,
    `- категорія: ${TRACK_LABELS[idea.track] ?? idea.track}`,
    `- ${SIGNAL_TYPE_LABELS[idea.signal_type] ?? idea.signal_type}`,
    `- заявлений дохід: ${idea.claimed_revenue || "не заявлено"}`,
    `- суть механіки: ${idea.mechanic_summary || "—"}`,
    `- гіпотеза монетизації: ${idea.monetization_hypothesis || "—"}`,
  ];
  if (sources.length > 0) {
    lines.push("- джерела знахідки:");
    for (const source of sources.slice(0, 10)) {
      lines.push(
        `  - ${source.url} (дата: ${source.published_date || "?"}, ` +
          `інтерес автора: ${source.author_interest || "?"})`,
      );
    }
  }
  const context = lines.join("\n");
  return rest ? `${context}\n\nОпис механіки з картки:\n\n${rest}` : context;
}

export interface HandoffPromptInput {
  idea: IdeaContextInput;
  sources: SourceContextInput[];
  template: string;
  criteriaDoc: string;
  deepDoc: string;
  today: string;
}

// Шапка до першого `---` адресована супровіднику репозиторію, а не моделі:
// вона є і в шаблоні промпта, і в кожному зовнішньому брифі (agents/criteria/
// external/*.md пишуться за тим самим форматом), тому цю функцію застосовано
// до всіх трьох вклеюваних документів нижче — інакше шапка брифу поїде в
// чуже вікно як частина «дослідницького завдання».
function stripMaintainerHeader(template: string): string {
  const separator = template.match(/^---\s*$/m);
  if (!separator?.index) return template;
  return template.slice(separator.index + separator[0].length).trimStart();
}

// {{RESEARCHER_LABEL}} свідомо лишається літеральним: його вписує власник у
// скопійованому тексті, окремо для кожного вікна моделі.
export function renderHandoffPrompt(input: HandoffPromptInput): string {
  const baseKeys = BASE_CRITERIA_KEYS_BY_TRACK[input.idea.track];
  if (!baseKeys) {
    throw new Error(`Трек «${input.idea.track}» не має чек-листа критеріїв`);
  }
  const values: Record<string, string> = {
    IDEA_ID: input.idea.id,
    TRACK: input.idea.track,
    TODAY: input.today,
    IDEA_CONTEXT: buildIdeaContext(input.idea, input.sources),
    CRITERIA_DOC: stripMaintainerHeader(input.criteriaDoc),
    DEEP_DOC: stripMaintainerHeader(input.deepDoc),
    MAX_BASE_KEY: baseKeys[baseKeys.length - 1],
    EXPECTED_COUNT: String(baseKeys.length + DEEP_RESEARCH_KEYS.length),
  };
  let text = stripMaintainerHeader(input.template);
  for (const [key, value] of Object.entries(values)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }
  return text;
}
