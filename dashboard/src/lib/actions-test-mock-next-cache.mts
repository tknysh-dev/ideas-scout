// Тестовий дублер next/cache: справжній revalidatePath кидає виняток поза
// запитовим контекстом Next.js ("Invariant: static generation store missing"),
// тому в node --test його підміняє резолвер-хук на цей шпигун-стаб.

export const mockCacheState: { calls: unknown[][] } = { calls: [] };

export function resetMockCache() {
  mockCacheState.calls = [];
}

export function revalidatePath(...args: unknown[]) {
  mockCacheState.calls.push(args);
}
