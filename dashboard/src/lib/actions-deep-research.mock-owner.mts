// Тестовий дублер @/lib/owner.server для actions-deep-research.test.mts.
// Справжній owner.server.ts починається з `import "server-only"` і піднімає
// NextAuth через @/auth — зайве й неможливе в node --test.

export interface MockOwnerResult {
  login?: string;
  error?: string;
}

export const mockOwnerState: { result: MockOwnerResult } = { result: { login: "owner-login" } };

export function resetMockOwner() {
  mockOwnerState.result = { login: "owner-login" };
}

export async function ownerLogin(): Promise<MockOwnerResult> {
  return mockOwnerState.result;
}
