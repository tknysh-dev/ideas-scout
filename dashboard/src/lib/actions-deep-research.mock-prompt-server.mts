// Тестовий дублер @/lib/deep-research-prompt.server для actions-deep-research.test.mts.
// Справжній модуль починається з `import "server-only"` і читає файли конфігурації
// через Supabase/GitHub — зайве, коли тестується лише обгортка fetchDeepResearchPrompt.

export type MockPromptResult = { prompt: string } | { error: string };

export const mockPromptState: { result: MockPromptResult } = { result: { prompt: "PROMPT" } };

export function resetMockPromptServer() {
  mockPromptState.result = { prompt: "PROMPT" };
}

export async function buildDeepResearchPrompt(): Promise<MockPromptResult> {
  return mockPromptState.result;
}
