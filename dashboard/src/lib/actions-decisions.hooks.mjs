// ESM loader-хук лише для actions-decisions.test.mts. Він не чіпає
// actions/decisions.ts: підміняє резолюцію бare-специфікаторів для процесу тесту.
//
// - "next/cache" -> стаб-шпигун: справжній revalidatePath кидає виняток поза
//   запитовим контекстом Next.js.
// - "@/auth" -> тестовий дублер: справжній auth.ts піднімає NextAuth (GitHub
//   OAuth), зайве й неможливе в node --test.
// - "@/lib/supabase/service" -> тестовий дублер: справжній service.ts починається
//   з `import "server-only"`, який кидає виняток поза Server Component.
// - "@/lib/config", "@/lib/decisions-logic" -> ті самі модулі, що й у проді,
//   лише резолвляться напряму (плейн Node не знає про tsconfig path alias "@/*",
//   це робить лише бандлер Next).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/cache") {
    return nextResolve(new URL("./actions-test-mock-next-cache.mts", import.meta.url).href, context);
  }
  if (specifier === "@/auth") {
    return nextResolve(new URL("./actions-decisions.mock-auth.mts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/supabase/service") {
    return nextResolve(new URL("./actions-test-mock-service.mts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/config") {
    return nextResolve(new URL("./config.ts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/decisions-logic") {
    return nextResolve(new URL("./decisions-logic.ts", import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
