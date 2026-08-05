// Чиста логіка межі авторизації (auth.ts callbacks, proxy.ts isPublic/unconfigured),
// винесена окремо, щоб її можна було накрити node --test без NextAuth, GitHub OAuth
// і реального middleware-раннера. Дзеркалить те, як уже розділені
// runner.sh/runner-lib.sh, telegram-webhook.ts та decisions-logic.ts.

// Форма значення, яке повертає getAuthEnv() з config.ts. Локальний тип замість
// імпорту звідти: ця логіка не має знати про process.env, тільки про дані.
export interface AuthEnv {
  secret: string;
  clientId: string;
  clientSecret: string;
  allowedLogin: string;
}

// Telegram не має GitHub-сесії, тому webhook публічний на рівні Auth.js. Сам route
// окремо fail-closed перевіряє секретний заголовок Telegram до будь-якого запису.
export const PUBLIC_PATHS = ["/login", "/api/auth", "/api/telegram/webhook"];

export function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export type UnconfiguredVerdict = "allow" | "redirect-to-login";

// Поведінка, коли AUTH_* не заповнені. У dev пускаємо все, щоб можна було
// працювати без OAuth-застосунку; у проді — навпаки, закриваємо все, крім
// /login, яка пояснить, яких env бракує. Fail closed: попередня версія при
// відсутності env пускала всіх, і в проді це означало відкритий дашборд.
export function unconfigured(nodeEnv: string | undefined, pathname: string): UnconfiguredVerdict {
  if (nodeEnv === "development") return "allow";
  if (isPublic(pathname)) return "allow";
  return "redirect-to-login";
}

export interface SignInProfile {
  login?: unknown;
  [key: string]: unknown;
}

// Дашборд — на одного власника, тому allow-list звіряємо з GitHub login,
// а не з email: email у профілі GitHub може бути приватним і прийти null.
export function signIn(env: AuthEnv | null, profile: SignInProfile | null | undefined): boolean {
  if (!env) return false;
  return profile?.login === env.allowedLogin;
}

export interface AuthToken {
  login?: unknown;
  [key: string]: unknown;
}

export function jwt(token: AuthToken, profile: SignInProfile | null | undefined): AuthToken {
  if (typeof profile?.login === "string") {
    token.login = profile.login;
  }
  return token;
}

export interface AuthSession {
  user: AuthToken;
  [key: string]: unknown;
}

export function session(session: AuthSession, token: AuthToken): AuthSession {
  if (typeof token.login === "string") {
    session.user.login = token.login;
  }
  return session;
}
