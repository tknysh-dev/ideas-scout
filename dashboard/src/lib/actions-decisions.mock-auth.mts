// Тестовий дублер @/auth для actions-decisions.test.mts. Справжній auth.ts
// налаштовує NextAuth (GitHub OAuth, JWT) — зайве й неможливе в node --test.

export interface MockSession {
  user?: { login?: string };
}

export const mockAuthState: { session: MockSession | null } = { session: null };

export function resetMockAuth() {
  mockAuthState.session = null;
}

export async function auth() {
  return mockAuthState.session;
}
