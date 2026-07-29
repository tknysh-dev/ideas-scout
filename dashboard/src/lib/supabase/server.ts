import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getAuthEnv } from "@/lib/config";

// Клієнт для читання сесії користувача (Supabase Auth) у server components/route
// handlers. Використовує лише публічний anon-ключ — жодних даних з БД тут не читаємо,
// це виключно перевірка "хто залогінений".
export async function getAuthServerClient() {
  const env = getAuthEnv();
  if (!env) return null;

  const cookieStore = await cookies();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // set() викликаний із server component без можливості писати cookie —
          // безпечно ігнорувати, якщо є proxy, що освіжає сесію.
        }
      },
    },
  });
}
