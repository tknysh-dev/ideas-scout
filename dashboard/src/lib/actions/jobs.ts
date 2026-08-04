"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getAuthEnv } from "@/lib/config";
import { getServiceClient } from "@/lib/supabase/service";

export interface EnqueueJobResult {
  jobId?: string;
  alreadyQueued?: boolean;
  error?: string;
}

const IDEA_ID_RE = /^[A-Z]{2,10}-\d{3,8}$/;

async function ownerLogin(): Promise<{ login?: string; error?: string }> {
  const authEnv = getAuthEnv();
  if (!authEnv) {
    return process.env.NODE_ENV === "development"
      ? { login: "dev" }
      : { error: "Авторизацію не налаштовано." };
  }

  const session = await auth();
  if (!session?.user) return { error: "Потрібен вхід у дашборд." };
  if (session.user.login !== authEnv.allowedLogin) {
    return { error: "Цей акаунт не має права створювати завдання." };
  }
  return { login: session.user.login };
}

export async function enqueueInfrastructureDryRun(): Promise<EnqueueJobResult> {
  const owner = await ownerLogin();
  if (owner.error) return { error: owner.error };

  const supabase = getServiceClient();
  if (!supabase) return { error: "Немає доступу до бази." };

  const { data, error } = await supabase
    .from("jobs")
    .insert({
      type: "infrastructure_dry_run",
      requested_by: `owner:dashboard:${owner.login}`,
    })
    .select("id")
    .single();

  if (error) return { error: `Не вдалося створити job: ${error.message}` };
  revalidatePath("/runs");
  return { jobId: data.id };
}

// Автоматичний конвеєр дослідження демонтовано (docs/plans/deep-research-handoff.md):
// живий веб-пошук лишився тільки в браузерних UI, тому дослідження тепер
// починається з копіювання промпта, а не з постановки job-а. Стара кнопка
// зникає у фазі 5; доти дія існує лише щоб пояснити це власнику, а не покласти
// в чергу job, який нікому виконувати.
export async function enqueueDeepResearch(ideaId: string): Promise<EnqueueJobResult> {
  const owner = await ownerLogin();
  if (owner.error) return { error: owner.error };
  if (!IDEA_ID_RE.test(ideaId)) return { error: "Некоректний ID ідеї." };

  return {
    error:
      "Автоматичне глибоке дослідження вимкнено. Тепер промпт копіюється вручну " +
      "в deep-research режим кількох моделей, а відповіді вставляються назад на портал.",
  };
}
