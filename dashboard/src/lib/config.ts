// Централізована перевірка обов'язкових env — щоб сторінки деградували
// зрозумілою помилкою конфігурації, а не падали з 500.

export function getDataEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function getAuthEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const allowedEmail = process.env.ALLOWED_EMAIL;
  if (!url || !anonKey) return null;
  return { url, anonKey, allowedEmail: allowedEmail ?? null };
}

export function getGithubEnv() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  return { token, owner: "tknysh-dev", repo: "ideas-scout", branch: "main" };
}
