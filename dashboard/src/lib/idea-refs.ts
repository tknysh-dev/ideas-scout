import type { IdeaStatus } from "@/lib/types";

// Формат id — '<TRACK_PREFIX>-<0042>' (shared/schema.sql): PI-0001, APP-0013.
const IDEA_ID_SOURCE = "\\b[A-Z]{2,6}-\\d{3,5}\\b";

// Фабрика замість спільного модульного /g-регексу: стейт lastIndex одного
// singleton-а протікав між незалежними викликами (linkify.tsx і
// rehype-idea-refs.ts мусили самі памʼятати про lastIndex = 0). Кожен виклик
// отримує власний регекс і власний стан.
export function createIdeaIdPattern(): RegExp {
  return new RegExp(IDEA_ID_SOURCE, "g");
}

export interface IdeaRef {
  id: string;
  title: string;
  status: IdeaStatus;
  summary: string | null;
}
