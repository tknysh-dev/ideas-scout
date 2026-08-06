import "server-only";
import { auth } from "@/auth";
import { getAuthEnv } from "@/lib/config";

export interface OwnerCheck {
  login?: string;
  error?: string;
}

// Кожна дія власника — точка входу, доступна прямим POST-запитом, не лише через
// UI, тому сесію перевіряє сама дія, а не факт того, що кнопку десь показано.
export async function ownerLogin(): Promise<OwnerCheck> {
  const authEnv = getAuthEnv();
  if (!authEnv) {
    return process.env.NODE_ENV === "development"
      ? { login: "dev" }
      : { error: "Авторизацію не налаштовано." };
  }

  const session = await auth();
  if (!session?.user) return { error: "Потрібен вхід у дашборд." };
  // GitHub логіни регістронезалежні на своєму боці — порівнюємо в нижньому регістрі,
  // інакше allow-list розрізняв би 'Octocat' і 'octocat' як різні акаунти.
  if (session.user.login?.toLowerCase() !== authEnv.allowedLogin.toLowerCase()) {
    return { error: "Цей акаунт не має права створювати завдання." };
  }
  return { login: session.user.login };
}
