import type { IdeaStatus } from "@/lib/types";

// Формат id — '<TRACK_PREFIX>-<0042>' (shared/schema.sql): PI-0001, APP-0013.
export const IDEA_ID_PATTERN = /\b[A-Z]{2,6}-\d{3,5}\b/g;

export interface IdeaRef {
  id: string;
  title: string;
  status: IdeaStatus;
  summary: string | null;
}
