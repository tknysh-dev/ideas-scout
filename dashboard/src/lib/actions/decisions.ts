"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getAuthEnv } from "@/lib/config";
import { getServiceClient } from "@/lib/supabase/service";
import { OWNER_DECIDABLE_STATUSES, statusMeta } from "@/lib/status";
import type { IdeaStatus, RejectionCode } from "@/lib/types";

export type DecisionAction = "accepted" | "rejected";

const REJECTION_CODES: readonly RejectionCode[] = [
  "NO_MONETIZATION",
  "SOURCE_SUSPECT",
  "LEGAL",
  "CAPABILITY_GAP",
  "CAPITAL",
  "AUTONOMY",
  "SATURATED",
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

export interface DecideIdeaResult {
  error?: string;
}

// Кожна дія власника — точка входу, доступна прямим POST-запитом, не лише
// через UI, тому сесію й email перевіряємо тут, а не покладаємось на те, що
// кнопку показано лише у "правильному" місці інтерфейсу. Service-key клієнт
// обходить RLS, тож без цієї перевірки будь-хто зі знанням URL міг би
// змінювати статуси ідей.
async function assertOwner(): Promise<string | null> {
  const authEnv = getAuthEnv();
  if (!authEnv) {
    // У dev без OAuth-застосунку перевіряти нічого — так само деградує proxy.ts.
    // У проді відсутність env означає «нікому не можна», а не «можна всім».
    return process.env.NODE_ENV === "development"
      ? null
      : "Авторизацію не налаштовано.";
  }

  const session = await auth();
  if (!session?.user) return "Потрібен вхід у дашборд.";
  if (session.user.login !== authEnv.allowedLogin) {
    return "Цей акаунт не має доступу до рішень власника.";
  }
  return null;
}

export async function decideIdea(input: DecideIdeaInput): Promise<DecideIdeaResult> {
  const authError = await assertOwner();
  if (authError) return { error: authError };

  const { ideaId, action, rejectionCode } = input;
  const reason = input.reason.trim();

  if (!ideaId) return { error: "Не вказано ідею." };
  if (!["accepted", "rejected"].includes(action)) {
    return { error: "Невідома дія." };
  }
  if (action === "rejected") {
    if (!reason) return { error: "Для відхилення обов'язково вкажи причину." };
    if (!rejectionCode || !REJECTION_CODES.includes(rejectionCode as RejectionCode)) {
      return { error: "Обери код відмови зі словника." };
    }
  }

  const supabase = getServiceClient();
  if (!supabase) return { error: "Немає доступу до бази." };

  const { data: idea, error: fetchError } = await supabase
    .from("ideas")
    .select("id,status,rejection_code")
    .eq("id", ideaId)
    .maybeSingle();

  if (fetchError) return { error: `Помилка читання ідеї: ${fetchError.message}` };
  if (!idea) return { error: "Ідею не знайдено." };

  const current = idea.status as IdeaStatus;
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
  if (current === action && !(action === "rejected" && idea.rejection_code !== rejectionCode)) {
    return { error: `Ідея вже в статусі «${statusMeta(current).label}».` };
  }

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

  const { error: updateError } = await supabase
    .from("ideas")
    .update(updatePayload)
    .eq("id", ideaId);

  if (updateError) return { error: `Помилка оновлення статусу: ${updateError.message}` };

  const changeSuffix = action === "rejected" ? ` (${rejectionCode})` : "";
  const label = isRevision ? `${CHANGE_LABEL[action]}, переглянувши рішення` : CHANGE_LABEL[action];
  const { error: eventError } = await supabase.from("events").insert({
    idea_id: ideaId,
    actor: "owner:dashboard",
    change: `status: ${current} -> ${action}${changeSuffix} — ${label}`,
    reason: reason || null,
  });

  if (eventError) {
    return { error: `Статус оновлено, але подію не записано: ${eventError.message}` };
  }

  revalidatePath("/", "layout");

  return {};
}
