// Людські назви й кольори словників — джерело: shared/contracts.md
import type {
  AuthorInterest,
  Confidence,
  IdeaStatus,
  RejectionCode,
  SignalType,
} from "./types";

export const STATUS_META: Record<
  IdeaStatus,
  { label: string; hint: string; tone: string }
> = {
  new: {
    label: "Нова",
    hint: "Щойно зібрана або надіслана знахідка, аналітик ще не торкався",
    tone: "new",
  },
  analyzing: {
    label: "У аналізі",
    hint: "Аналітик у процесі; або чекає погодження власника на докупку понад €100",
    tone: "analyzing",
  },
  rejected: {
    label: "Відхилена",
    hint: "Провалила фатальний критерій чек-листа",
    tone: "rejected",
  },
  approved_pending: {
    label: "Очікує",
    hint: "Пройшла формальні фільтри, останнє слово — за власником",
    tone: "approved_pending",
  },
  accepted: {
    label: "Прийнята",
    hint: "Власник визнав ідею годною — збирач шукатиме схожі механіки",
    tone: "accepted",
  },
  transferred: {
    label: "Перенесена",
    hint: "Належить іншому треку, перенесена в інший реєстр",
    tone: "transferred",
  },
};

// Статус приходить із бази, а не з типів: поки міграція не накотилась (або якщо
// агент запише щось поза словником), сторінка має показати значення як є, а не
// впасти на undefined.
export function statusMeta(status: IdeaStatus) {
  return (
    STATUS_META[status] ?? {
      label: status,
      hint: "Статус поза словником shared/contracts.md",
      tone: "analyzing",
    }
  );
}

// Статуси, у яких кнопки рішення власника мають сенс: черга на рішення і вже
// ухвалені рішення — їх власник може переглянути. `new`/`analyzing` належать
// аналітику (втручання гонилось би з активним прогоном), `transferred` —
// технічний стан переносу в інший трек.
export const OWNER_DECIDABLE_STATUSES: readonly IdeaStatus[] = [
  "approved_pending",
  "accepted",
  "rejected",
];

export const REJECTION_META: Record<RejectionCode, string> = {
  NO_MONETIZATION: "Немає гіпотези монетизації",
  SOURCE_SUSPECT: "Джерело під підозрою (рівень довіри D)",
  LEGAL: "Юридична заборона",
  CAPABILITY_GAP: "Бракує можливостей наявних інструментів",
  CAPITAL: "Бракує коштів на інструмент",
  AUTONOMY: "Не проходить поріг автономності підтримки",
  SATURATED: "Ринок насичений",
  NO_MARKET: "Немає ознак ринку/попиту",
};

export const CONFIDENCE_META: Record<Confidence, { label: string; tone: string }> = {
  high: { label: "Висока", tone: "high" },
  medium: { label: "Середня", tone: "medium" },
  low: { label: "Низька", tone: "low" },
};

export const SIGNAL_TYPE_META: Record<SignalType, string> = {
  income_claim: "Заявлений дохід",
  automation_report: "Звіт про автоматизацію (без цифри)",
};

export const AUTHOR_INTEREST_META: Record<AuthorInterest, string> = {
  none: "Не зацікавлений",
  affiliate: "Реферальне посилання",
  course_seller: "Продає курс на цю тему",
  tool_vendor: "Продає дотичний інструмент",
};

export const TRACK_META: Record<string, string> = {
  "passive-income": "Пасивний дохід",
  "app-ideas": "Мобільні застосунки",
};

export function trackLabel(track: string): string {
  return TRACK_META[track] ?? track;
}

export const IDEA_TYPE_META: Record<string, { label: string; hint: string }> = {
  mechanic: {
    label: "Механіка",
    hint: "Патерн заробітку як категорія: сам по собі не запускається, рішення ухвалюються в його нішах",
  },
  niche: {
    label: "Ніша",
    hint: "Конкретна реалізація механіки — саме її оцінює чек-лист і по ній ухвалюється рішення",
  },
};

export function ideaTypeMeta(type: string) {
  return IDEA_TYPE_META[type] ?? { label: type, hint: "Тип поза словником shared/contracts.md" };
}
