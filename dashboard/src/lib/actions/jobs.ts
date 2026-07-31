"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getAuthEnv } from "@/lib/config";
import { getServiceClient } from "@/lib/supabase/service";

export interface EnqueueJobResult {
  jobId?: string;
  error?: string;
}

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
