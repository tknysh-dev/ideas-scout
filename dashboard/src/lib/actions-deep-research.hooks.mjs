// ESM loader-хук лише для actions-deep-research.test.mts. Не чіпає
// actions/deep-research.ts: підміняє резолюцію бare-специфікаторів для процесу тесту.
//
// - "next/cache" -> стаб-шпигун revalidatePath (справжній кидає виняток поза
//   запитовим контекстом Next.js).
// - "@/lib/owner.server", "@/lib/deep-research-prompt.server" -> тестові дублери:
//   обидва починаються з `import "server-only"`, який кидає виняток поза
//   Server Component.
// - "@/lib/supabase/service" -> той самий дублер, що й у actions-decisions.test.mts.
// - "@/lib/deep-research-logic", "@/lib/deep-research-reports" -> реальні модулі
//   (чиста логіка без IO), лише резолвляться напряму (плейн Node не розуміє
//   tsconfig path alias "@/*").
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/cache") {
    return nextResolve(new URL("./actions-test-mock-next-cache.mts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/owner.server") {
    return nextResolve(new URL("./actions-deep-research.mock-owner.mts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/deep-research-prompt.server") {
    return nextResolve(new URL("./actions-deep-research.mock-prompt-server.mts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/supabase/service") {
    return nextResolve(new URL("./actions-test-mock-service.mts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/deep-research-logic") {
    return nextResolve(new URL("./deep-research-logic.ts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/deep-research-reports") {
    return nextResolve(new URL("./deep-research-reports.ts", import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
