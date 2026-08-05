// Тестовий дублер @/lib/supabase/service, підставлюваний резолвер-хуком
// telegram-webhook-route.hooks.mjs замість реального route.ts. Реальний
// service.ts починається з `import "server-only"`, який кидає виняток поза
// Server Component, і в будь-якому разі не мусить ходити в мережу з тестів.

export interface MockInsertResult {
  data: unknown;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
}

interface MockState {
  clientAvailable: boolean;
  insertResult: MockInsertResult;
  lastInsertedRows: unknown[] | null;
}

export const mockState: MockState = {
  clientAvailable: true,
  insertResult: { data: [], error: null },
  lastInsertedRows: null,
};

export function resetMockService() {
  mockState.clientAvailable = true;
  mockState.insertResult = { data: [], error: null };
  mockState.lastInsertedRows = null;
}

export function getServiceClient() {
  if (!mockState.clientAvailable) return null;
  return {
    from() {
      return {
        insert(rows: unknown[]) {
          mockState.lastInsertedRows = rows;
          return {
            select() {
              return Promise.resolve(mockState.insertResult);
            },
          };
        },
      };
    },
  };
}
