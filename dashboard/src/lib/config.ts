// Централізована перевірка обов'язкових env — щоб сторінки деградували
// зрозумілою помилкою конфігурації, а не падали з 500.

export function getDataEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export const AUTH_VARS = [
  "AUTH_SECRET",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "ALLOWED_GITHUB_LOGIN",
] as const;

// ALLOWED_GITHUB_LOGIN обов'язковий, а не опційний: без allow-list вхід через
// GitHub OAuth відкритий будь-якому акаунту GitHub, тобто всьому інтернету.
export function getAuthEnv() {
  const secret = process.env.AUTH_SECRET;
  const clientId = process.env.AUTH_GITHUB_ID;
  const clientSecret = process.env.AUTH_GITHUB_SECRET;
  const allowedLogin = process.env.ALLOWED_GITHUB_LOGIN;
  if (!secret || !clientId || !clientSecret || !allowedLogin) return null;
  return { secret, clientId, clientSecret, allowedLogin };
}

export type ConfigSource = "local" | "github";

// Звідки сторінка /config бере промпти й критерії. Локально — з робочої копії,
// щоб правки було видно до пушу; у проді робочої копії немає, тільки GitHub API.
export function getConfigSource(): ConfigSource {
  const explicit = process.env.CONFIG_SOURCE;
  if (explicit === "local" || explicit === "github") return explicit;
  return process.env.NODE_ENV === "development" ? "local" : "github";
}

export function getGithubEnv() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  return { token, owner: "tknysh-dev", repo: "ideas-scout", branch: "main" };
}
