import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getDataEnv } from "@/lib/config";

// Service-role клієнт для читання даних — тільки server-side (server components,
// route handlers). Ключ ніколи не імпортується в клієнтський код завдяки "server-only".
export function getServiceClient() {
  const env = getDataEnv();
  if (!env) return null;
  return createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
