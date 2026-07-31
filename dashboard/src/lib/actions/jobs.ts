"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getAuthEnv } from "@/lib/config";
import { getServiceClient } from "@/lib/supabase/service";
import { OWNER_DECIDABLE_STATUSES } from "@/lib/status";
import type { IdeaStatus } from "@/lib/types";

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

export async function enqueueDeepResearch(ideaId: string): Promise<EnqueueJobResult> {
  const owner = await ownerLogin();
  if (owner.error) return { error: owner.error };
  if (!IDEA_ID_RE.test(ideaId)) return { error: "Некоректний ID ідеї." };

  const supabase = getServiceClient();
  if (!supabase) return { error: "Немає доступу до бази." };

  // Не довіряємо ID із клієнта: кнопка може бути видима на старому рендері, а
  // Server Action доступний прямим POST. Перед enqueue перечитуємо актуальний рядок.
  const { data: idea, error: ideaError } = await supabase
    .from("ideas")
    .select("id,status")
    .eq("id", ideaId)
    .maybeSingle();
  if (ideaError) return { error: `Не вдалося перевірити ідею: ${ideaError.message}` };
  if (!idea) return { error: "Ідею не знайдено." };
  if (!OWNER_DECIDABLE_STATUSES.includes(idea.status as IdeaStatus)) {
    return { error: "Глибоке дослідження доступне після первинної оцінки ідеї." };
  }

  // Одна хвилина — вікно захисту від подвійного кліку/повтору Server Action.
  // Пізніше ту саму ідею можна свідомо запустити ще раз.
  const idempotencyKey = `deep-research:${ideaId}:${Math.floor(Date.now() / 60_000)}`;
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      type: "deep_research",
      payload: { idea_id: ideaId },
      requested_by: `owner:dashboard:${owner.login}`,
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    const { data: existing } = await supabase
      .from("jobs")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    return { jobId: existing?.id, alreadyQueued: true };
  }
  if (error) return { error: `Не вдалося створити дослідження: ${error.message}` };

  revalidatePath("/runs");
  return { jobId: data.id };
}
