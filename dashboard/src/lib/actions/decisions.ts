"use server";

import { revalidatePath } from "next/cache";
import { getAuthEnv } from "@/lib/config";
import { getAuthServerClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";
import type { RejectionCode } from "@/lib/types";

export type DecisionAction = "active" | "parked" | "rejected";

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
  active: "власник активував механіку",
  parked: "власник відклав рішення",
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
  // Локальна розробка без NEXT_PUBLIC_SUPABASE_ANON_KEY: авторизацію не
  // перевіряємо — так само, як існуючий proxy.ts (middleware) деградує в dev.
  if (!authEnv) return null;

  const supabase = await getAuthServerClient();
  if (!supabase) return "Немає доступу до авторизації.";

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return "Потрібен вхід у дашборд.";
  if (authEnv.allowedEmail && user.email !== authEnv.allowedEmail) {
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
  if (!["active", "parked", "rejected"].includes(action)) {
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
    .select("id,status")
    .eq("id", ideaId)
    .maybeSingle();

  if (fetchError) return { error: `Помилка читання ідеї: ${fetchError.message}` };
  if (!idea) return { error: "Ідею не знайдено." };
  if (idea.status !== "approved_pending") {
    return { error: "Рішення доступне лише для ідей у статусі «Очікує рішення»." };
  }

  const updatePayload: Record<string, unknown> = { status: action };
  if (action === "rejected") {
    updatePayload.rejection_code = rejectionCode;
    updatePayload.rejection_detail = reason;
  }

  const { error: updateError } = await supabase
    .from("ideas")
    .update(updatePayload)
    .eq("id", ideaId);

  if (updateError) return { error: `Помилка оновлення статусу: ${updateError.message}` };

  const changeSuffix = action === "rejected" ? ` (${rejectionCode})` : "";
  const { error: eventError } = await supabase.from("events").insert({
    idea_id: ideaId,
    actor: "owner:dashboard",
    change: `status: approved_pending -> ${action}${changeSuffix} — ${CHANGE_LABEL[action]}`,
    reason: reason || null,
  });

  if (eventError) {
    return { error: `Статус оновлено, але подію не записано: ${eventError.message}` };
  }

  revalidatePath("/", "layout");

  return {};
}
