// Тестовий дублер @/auth, підставлюваний резолвер-хуком proxy.hooks.mjs
// замість реального auth.ts. Реальний auth.ts викликає NextAuth(...) із
// GitHub-провайдером при імпорті — зайва вага для тесту гейта, якому
// потрібно лише керовано вмикати/вимикати сесію на request.auth, а не
// відтворювати OAuth-обмін і JWT-кукі.

export interface MockSession {
  user: { login?: string };
}

interface MockAuthState {
  session: MockSession | null;
}

export const mockAuthState: MockAuthState = { session: null };

export function resetMockAuth() {
  mockAuthState.session = null;
}

type NextRequestLike = { auth?: MockSession | null };
type Handler<T extends NextRequestLike> = (request: T) => unknown;

// Сигнатура повторює auth() з next-auth: обгортає хендлер proxy.ts і перед
// викликом навішує на request поле auth — так само як справжній next-auth
// робить це, розкодувавши JWT з кукі.
export function auth<T extends NextRequestLike>(handler: Handler<T>) {
  return (request: T) => {
    request.auth = mockAuthState.session;
    return handler(request);
  };
}
