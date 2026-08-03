// Чек-листи критеріїв — джерело правди: agents/criteria/criteria-*.md.
// Дашборд показує повний перелік критеріїв треку завжди, а тіло ідеї лише
// заповнює ті з них, які аналітик реально оцінював.

import type { Idea, SignalType } from "./types";

export interface CriterionSpec {
  n: number;
  title: string;
  fatal: boolean;
  // Критерій 0 оцінюється лише для automation_report — для решти записів це не
  // «пропущено аналітиком», а «не застосовується за правилами чек-листа».
  onlyForSignal?: SignalType;
  // Критерії, які на рівні механіки делегуються нішам-дітям.
  delegatedByMechanic?: boolean;
}

const PASSIVE_INCOME: CriterionSpec[] = [
  { n: 0, title: "Гіпотеза монетизації", fatal: true, onlyForSignal: "automation_report" },
  { n: 1, title: "Довіра до джерела", fatal: true },
  { n: 2, title: "Легальність", fatal: true },
  { n: 3, title: "Реалізовність наявними засобами", fatal: true, delegatedByMechanic: true },
  { n: 4, title: "Автономність", fatal: true, delegatedByMechanic: true },
  { n: 5, title: "Насиченість ринку", fatal: true, delegatedByMechanic: true },
  { n: 6, title: "Стеля доходу / зусилля-до-віддачі", fatal: false, delegatedByMechanic: true },
];

const APP_IDEAS: CriterionSpec[] = [
  { n: 0, title: "Гіпотеза цінності", fatal: true, onlyForSignal: "automation_report" },
  { n: 1, title: "Довіра до джерела", fatal: true },
  { n: 2, title: "Легальність і політики платформ", fatal: true },
  { n: 3, title: "Реалізовність соло-розробником", fatal: true, delegatedByMechanic: true },
  { n: 4, title: "Розмір ринку і попит", fatal: true, delegatedByMechanic: true },
  { n: 5, title: "Конкуренція і диференціація", fatal: true, delegatedByMechanic: true },
  { n: 6, title: "Монетизація", fatal: false, delegatedByMechanic: true },
  { n: 7, title: "Очікувані зусилля", fatal: false, delegatedByMechanic: true },
];

const CHECKLISTS: Record<string, CriterionSpec[]> = {
  "passive-income": PASSIVE_INCOME,
  "app-ideas": APP_IDEAS,
};

export type CriterionTone = "passed" | "failed" | "owner" | "skipped" | "noted";

export interface CriterionResult {
  spec: CriterionSpec;
  tone: CriterionTone;
  verdict: string;
  body: string;
  // Заповнено, якщо аналітик розібрав кілька критеріїв одним абзацом.
  sharedWith?: number[];
  // true, якщо тон і вердикт узято зі структурованого запису глибокого
  // дослідження, а не відновлено з прози регуляркою.
  structured?: boolean;
}

const SECTION_HEADING = /^##\s+Аналіз за критеріями\s*$/m;

// Тіло ідеї — це Markdown із реєстру; секцію критеріїв показуємо окремим
// блоком, а решту прози віддаємо як є.
export function splitCriteriaSection(body: string | null): {
  section: string | null;
  rest: string;
} {
  if (!body) return { section: null, rest: "" };

  const match = SECTION_HEADING.exec(body);
  if (!match) return { section: null, rest: body };

  const start = match.index;
  const afterHeading = start + match[0].length;
  const nextHeading = body.slice(afterHeading).search(/^##\s+/m);
  const end = nextHeading === -1 ? body.length : afterHeading + nextHeading;

  return {
    section: body.slice(afterHeading, end).trim(),
    rest: (body.slice(0, start) + "\n\n" + body.slice(end)).trim(),
  };
}

function toneOf(lead: string): CriterionTone {
  const text = lead.toLowerCase();
  if (/провал|не пройдено/.test(text)) return "failed";
  if (/не оцін|не застосов|делеговано|пропущ/.test(text)) return "skipped";
  if (/ручну оцінк|питання до тебе|рішення власника|винесено/.test(text)) return "owner";
  if (/пройдено/.test(text)) return "passed";
  return "noted";
}

// «**3–5.**» → [3,4,5]; «**5 і 6 — не оцінювались.**» → [5,6].
function numbersFrom(lead: string): number[] {
  const match = /^\s*(\d+(?:\s*(?:[–—-]|і|та|,|\/)\s*\d+)*)/.exec(lead);
  if (!match) return [];

  const tokens = match[1].match(/\d+|[–—-]|і|та|,|\//g) ?? [];
  const result: number[] = [];
  let range = false;

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const value = Number(token);
      const previous = result[result.length - 1];
      if (range && previous !== undefined) {
        for (let i = previous + 1; i <= value; i += 1) result.push(i);
      } else {
        result.push(value);
      }
      range = false;
    } else {
      range = /[–—-]/.test(token);
    }
  }

  return result;
}

// Із «1. Довіра до джерела — пройдено (оцінка B)» лишаємо «пройдено (оцінка B)»:
// назву критерія сторінка бере з чек-листа, а не з тексту аналітика.
function verdictFrom(lead: string): string {
  const withoutNumber = lead.replace(/^\s*\d+(?:\s*(?:[–—-]|і|та|,|\/)\s*\d+)*\s*[.:]?\s*/, "");
  const dash = withoutNumber.search(/[–—]/);
  const tail = dash === -1 ? withoutNumber : withoutNumber.slice(dash + 1);
  return tail.replace(/^[\s.—–-]+|[\s.]+$/g, "");
}

// Абзаци секції без номера критерія — «Підсумок», «Припущення цього прогону».
export interface CriterionNote {
  title: string;
  body: string;
  summary: boolean;
}

export interface CriteriaAnalysis {
  results: CriterionResult[];
  notes: CriterionNote[];
}

function toNote(block: string): CriterionNote {
  const lead = /^\*\*([\s\S]+?)\*\*/.exec(block);
  if (!lead) return { title: "Зауваження", body: block, summary: false };

  const title = lead[1].replace(/[\s.:]+$/, "");
  return {
    title,
    body: block.slice(lead[0].length).replace(/^[\s.]+/, ""),
    summary: /підсумок|висновок/i.test(title),
  };
}

// Структурований вердикт критерію (рядок синтезу глибокого дослідження).
// Мінімальна форма, щоб criteria.ts не залежав від таблиць БД.
export interface StructuredVerdict {
  tone: CriterionTone;
  summary: string | null;
}

export function analyzeCriteria(
  idea: Idea,
  section: string | null,
  // Після глибокого дослідження вердикти існують як дані, тож регулярка по
  // прозі більше не потрібна: вона лишається запасним шляхом для карток, які
  // глибокого дослідження ще не проходили.
  structured?: Map<string, StructuredVerdict>,
): CriteriaAnalysis | null {
  const checklist = CHECKLISTS[idea.track];
  if (!checklist) return null;

  const parsed = new Map<
    number,
    { tone: CriterionTone; verdict: string; body: string; group: number[] }
  >();
  const notes: CriterionNote[] = [];

  let current: { body: string } | null = null;

  for (const paragraph of (section ?? "").split(/\n\s*\n/)) {
    const block = paragraph.trim();
    if (!block) continue;

    const lead = /^\*\*([\s\S]+?)\*\*/.exec(block);
    const numbers = lead ? numbersFrom(lead[1]) : [];

    if (!lead || numbers.length === 0) {
      // Абзац-продовження без жирного зачину дописуємо до попереднього
      // критерію; самостійні блоки («**Підсумок.**») ідуть у кінець секції.
      if (!lead && current) {
        current.body = `${current.body}\n\n${block}`;
      } else {
        const note = toNote(block);
        notes.push(note);
        current = note;
      }
      continue;
    }

    let body = block.slice(lead[0].length).replace(/^[\s.]+/, "");
    // Вердикт у форматі «**3–5.** На рівні механіки не оцінюються» живе не в
    // жирному зачині, а в першому реченні абзацу — звідти й беремо, щоб не
    // дублювати те саме речення в пігулці й у тексті.
    let verdict = verdictFrom(lead[1]);
    if (!verdict) {
      verdict = (/^[\s\S]*?[.!?](?=\s|$)/.exec(body) ?? [""])[0];
      body = body.slice(verdict.length).trim();
    }

    const entry = {
      tone: toneOf(`${lead[1]} ${verdict}`),
      verdict,
      body,
      group: numbers,
    };
    for (const n of numbers) parsed.set(n, entry);
    current = entry;
  }

  const noneParsed = parsed.size === 0;
  // Чек-лист зупиняється на першому фатальному провалі — далі критерії не
  // «пропущені аналітиком», а свідомо не оцінювані.
  const stoppedAt = checklist
    .filter((spec) => spec.fatal && parsed.get(spec.n)?.tone === "failed")
    .map((spec) => spec.n)[0];

  const results = checklist.map<CriterionResult>((spec) => {
    const hit = parsed.get(spec.n);
    const exact = structured?.get(String(spec.n));

    if (!hit) {
      // Структурований вердикт без прози — звичайна ситуація для критеріїв,
      // яких первинний аналітик не згадував, а глибоке дослідження оцінило.
      if (exact) {
        return {
          spec,
          tone: exact.tone,
          verdict: exact.summary ?? "",
          body: "",
          structured: true,
        };
      }
      return {
        spec,
        tone: "skipped",
        verdict: fallbackVerdict(spec, idea, noneParsed, stoppedAt),
        body: "",
      };
    }
    // Спільний абзац показуємо один раз — на першому критерії групи, решта
    // лишає тільки вердикт і посилання на нього.
    const first = Math.min(...hit.group);
    return {
      spec,
      tone: exact ? exact.tone : hit.tone,
      verdict: exact?.summary || hit.verdict,
      body: spec.n === first ? hit.body : "",
      sharedWith: hit.group.length > 1 ? hit.group : undefined,
      structured: Boolean(exact),
    };
  });

  return { results, notes };
}

function fallbackVerdict(
  spec: CriterionSpec,
  idea: Idea,
  noneParsed: boolean,
  stoppedAt: number | undefined,
): string {
  if (spec.onlyForSignal && spec.onlyForSignal !== idea.signal_type) {
    return "не застосовується: критерій лише для звітів про автоматизацію";
  }
  if (stoppedAt !== undefined && spec.n > stoppedAt) {
    return `не оцінювався: чек-лист зупинився на фатальному провалі критерія ${stoppedAt}`;
  }
  if (idea.type === "mechanic" && spec.delegatedByMechanic) {
    return "на рівні механіки не оцінюється — рішення в нішах";
  }
  if (noneParsed) {
    return "у розборі не згаданий — дивись пояснення нижче";
  }
  return "не оцінювався: чек-лист зупинився раніше";
}
