"use server";

import { revalidatePath } from "next/cache";
import { ownerLogin } from "@/lib/owner.server";
import { getServiceClient } from "@/lib/supabase/service";

export interface EnqueueJobResult {
  jobId?: string;
  alreadyQueued?: boolean;
  error?: string;
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
