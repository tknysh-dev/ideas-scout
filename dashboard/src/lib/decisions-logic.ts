// Чиста логіка server action'а decisions.ts, винесена окремо, щоб переходи
// статусу ідеї — найдорожча для помилки частина порталу — накривались тестами
// без Supabase, auth і next/cache. Дзеркалить те, як уже розділені
// runner.sh/runner-lib.sh та telegram-webhook.ts.

import { OWNER_DECIDABLE_STATUSES, statusMeta } from "./status.ts";
import type { IdeaStatus, RejectionCode } from "./types.ts";

export type DecisionAction = "accepted" | "rejected";

export const REJECTION_CODES: readonly RejectionCode[] = [
  "NO_MONETIZATION",
  "SOURCE_SUSPECT",
  "LEGAL",
  "CAPABILITY_GAP",
  "CAPITAL",
  "AUTONOMY",
  "SATURATED",
  "NO_MARKET",
];

const CHANGE_LABEL: Record<DecisionAction, string> = {
  accepted: "власник прийняв ідею як годну",
  rejected: "власник відхилив ідею",
};

export interface DecideIdeaInput {
  ideaId: string;
  action: DecisionAction;
  reason: string;
  rejectionCode?: string;
}

/** Валідація форми: те, що приходить із браузера до будь-якого звернення в базу. */
export function validateDecisionInput(input: {
  ideaId: string;
  action: string;
  reason: string;
  rejectionCode?: string;
}): string | null {
  if (!input.ideaId) return "Не вказано ідею.";
  if (!["accepted", "rejected"].includes(input.action)) {
    return "Невідома дія.";
  }
  if (input.action === "rejected") {
    if (!input.reason) return "Для відхилення обов'язково вкажи причину.";
    if (!input.rejectionCode || !REJECTION_CODES.includes(input.rejectionCode as RejectionCode)) {
      return "Обери код відмови зі словника.";
    }
  }
  return null;
}

export interface DecisionTransitionCheck {
  error?: string;
  isRevision?: boolean;
}

/**
 * Чи можна перевести ідею зі статусу `current` рішенням `action`, і чи це
 * перегляд уже ухваленого рішення (isRevision) — впливає на текст події й на
 * те, чи причина обов'язкова.
 */
export function checkDecisionTransition(
  current: IdeaStatus,
  currentRejectionCode: string | null,
  action: DecisionAction,
  reason: string,
  rejectionCode: string | undefined,
): DecisionTransitionCheck {
  if (!OWNER_DECIDABLE_STATUSES.includes(current)) {
    return {
      error: `Статус «${statusMeta(current).label}» веде аналітик — рішення власника тут недоступне.`,
    };
  }

  // Перегляд уже ухваленого рішення — не те саме, що перше рішення по черзі:
  // без пояснення в events історія картки перестає читатись.
  const isRevision = current !== "approved_pending";
  if (isRevision && !reason) {
    return { error: "Зміна вже ухваленого рішення вимагає причини." };
  }
  if (current === action && !(action === "rejected" && currentRejectionCode !== rejectionCode)) {
    return { error: `Ідея вже в статусі «${statusMeta(current).label}».` };
  }
  return { isRevision };
}

export function buildIdeaUpdatePayload(
  action: DecisionAction,
  current: IdeaStatus,
  rejectionCode: string | undefined,
  reason: string,
): Record<string, unknown> {
  const updatePayload: Record<string, unknown> = { status: action };
  if (action === "rejected") {
    updatePayload.rejection_code = rejectionCode;
    updatePayload.rejection_detail = reason;
  } else if (current === "rejected") {
    // Код і деталі відмови описують вердикт, який власник щойно скасував —
    // лишити їх означало б показувати «Юридична заборона» на прийнятій ідеї.
    updatePayload.rejection_code = null;
    updatePayload.rejection_detail = null;
    updatePayload.rejection_codes_extra = [];
  }
  return updatePayload;
}

export function buildDecisionEventChange(
  current: IdeaStatus,
  action: DecisionAction,
  rejectionCode: string | undefined,
  isRevision: boolean,
): string {
  const changeSuffix = action === "rejected" ? ` (${rejectionCode})` : "";
  const label = isRevision ? `${CHANGE_LABEL[action]}, переглянувши рішення` : CHANGE_LABEL[action];
  return `status: ${current} -> ${action}${changeSuffix} — ${label}`;
}

export function buildDecisionEventRow(
  ideaId: string,
  current: IdeaStatus,
  action: DecisionAction,
  rejectionCode: string | undefined,
  isRevision: boolean,
  reason: string,
) {
  return {
    idea_id: ideaId,
    actor: "owner:dashboard",
    change: buildDecisionEventChange(current, action, rejectionCode, isRevision),
    reason: reason || null,
  };
}
