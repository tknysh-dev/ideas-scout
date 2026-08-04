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
  if (session.user.login !== authEnv.allowedLogin) {
    return { error: "Цей акаунт не має права створювати завдання." };
  }
  return { login: session.user.login };
}
