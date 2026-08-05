"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getAuthEnv } from "@/lib/config";
import { getServiceClient } from "@/lib/supabase/service";
import {
  buildDecisionEventRow,
  buildIdeaUpdatePayload,
  checkDecisionTransition,
  validateDecisionInput,
  type DecideIdeaInput,
  type DecisionAction,
} from "@/lib/decisions-logic";
import type { IdeaStatus } from "@/lib/types";

export type { DecideIdeaInput, DecisionAction };

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

  const inputError = validateDecisionInput({ ideaId, action, reason, rejectionCode });
  if (inputError) return { error: inputError };

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
  const transition = checkDecisionTransition(current, idea.rejection_code, action, reason, rejectionCode);
  if (transition.error) return { error: transition.error };

  const updatePayload = buildIdeaUpdatePayload(action, current, rejectionCode, reason);

  const { error: updateError } = await supabase
    .from("ideas")
    .update(updatePayload)
    .eq("id", ideaId);

  if (updateError) return { error: `Помилка оновлення статусу: ${updateError.message}` };

  const { error: eventError } = await supabase.from("events").insert(
    buildDecisionEventRow(ideaId, current, action, rejectionCode, transition.isRevision ?? false, reason),
  );

  if (eventError) {
    return { error: `Статус оновлено, але подію не записано: ${eventError.message}` };
  }

  revalidatePath("/", "layout");

  return {};
}
