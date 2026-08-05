// ESM loader-хук лише для proxy.test.mts. Не чіпає proxy.ts: підміняє
// резолюцію специфікаторів, яких plain Node не розуміє.
//
// 1) "next/server" і "next/experimental/testing/server" -> той самий файл
//    з розширенням ".js": пакет next не має "exports" у package.json, тому
//    ESM-резолвер Node не дописує розширення сам (на відміну від require())
//    і падає з ERR_MODULE_NOT_FOUND. Той самий прийом, що й у
//    telegram-webhook-route.hooks.mjs.
// 2) "@/auth", "@/lib/config", "@/lib/auth-logic" -> plain Node не знає
//    tsconfig path alias "@/*" (це розуміє лише бандлер Next), тому
//    специфікатори резолвимо на реальні файли вручну. "@/auth" веде на
//    дублер тут-таки в src/lib: справжній auth.ts будує NextAuth() з
//    GitHub-провайдером при імпорті, а тест гейта керує лише тим, є сесія
//    чи ні.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }
  if (specifier === "next/experimental/testing/server") {
    return nextResolve("next/experimental/testing/server.js", context);
  }
  if (specifier === "@/auth") {
    return nextResolve(new URL("./proxy.mock-auth.mts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/config") {
    return nextResolve(new URL("./config.ts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/auth-logic") {
    return nextResolve(new URL("./auth-logic.ts", import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
