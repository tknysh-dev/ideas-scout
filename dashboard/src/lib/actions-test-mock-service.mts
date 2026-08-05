// Тестовий дублер @/lib/supabase/service для тестів server actions у
// src/lib/actions/*.ts. Реальний service.ts починається з `import "server-only"`,
// який кидає виняток поза Server Component (пакет "server-only" кидає завжди,
// незалежно від середовища — умова "чи це браузер" вирішується підміною файлу
// бандлером, а не рантайм-перевіркою). Підміняється резолвер-хуком
// actions-decisions.hooks.mjs / actions-deep-research.hooks.mjs.
//
// Черга відповідей (queue) замість роутингу за таблицею: кожна дія викликає
// supabase у фіксованому, наперед відомому порядку, тому тест просто кладе
// відповіді в тому порядку, у якому їх забере код.

export interface MockResponse {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  /** Викликається синхронно в момент, коли черга віддає цю відповідь — потрібно
   * тестам, де стан клієнта (напр. clientAvailable) має змінитись МІЖ двома
   * послідовними зверненнями до supabase в одній дії. */
  onConsumed?: () => void;
}

interface MockState {
  clientAvailable: boolean;
  queue: MockResponse[];
  calls: { table: string; method: string; args: unknown[] }[];
}

export const mockState: MockState = {
  clientAvailable: true,
  queue: [],
  calls: [],
};

export function resetMockService() {
  mockState.clientAvailable = true;
  mockState.queue = [];
  mockState.calls = [];
}

const CHAIN_METHODS = [
  "select",
  "update",
  "insert",
  "eq",
  "is",
  "not",
  "order",
  "limit",
  "returns",
  "maybeSingle",
  "single",
] as const;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {
    then(resolve: (v: MockResponse) => unknown, reject: (e: unknown) => unknown) {
      const response = mockState.queue.shift() ?? { data: null, error: null };
      response.onConsumed?.();
      return Promise.resolve(response).then(resolve, reject);
    },
  };
  for (const method of CHAIN_METHODS) {
    chain[method] = (...args: unknown[]) => {
      mockState.calls.push({ table, method, args });
      return chain;
    };
  }
  return chain;
}

export function getServiceClient() {
  if (!mockState.clientAvailable) return null;
  return {
    from(table: string) {
      return makeChain(table);
    },
  };
}
