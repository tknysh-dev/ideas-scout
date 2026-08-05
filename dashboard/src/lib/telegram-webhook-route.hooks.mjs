// ESM loader-хук лише для telegram-webhook-route.test.mts. Він не чіпає
// route.ts: підміняє резолюцію двох бare-специфікаторів для процесу тесту.
//
// 1) "next/server" -> "next/server.js": пакет next не має "exports" у
//    package.json, тому ESM-резолвер Node (на відміну від require()) не
//    дописує розширення сам і падає з ERR_MODULE_NOT_FOUND. Turbopack/webpack
//    у реальному білді це розширення дописують, тому route.ts лишає імпорт
//    без розширення — саме так, як вимагає решта кодбази.
// 2) "@/lib/supabase/service" -> тестовий дублер тут-таки в src/lib: справжній
//    service.ts починається з `import "server-only"`, який кидає виняток при
//    імпорті поза Server Component. Дублер дає підмінний getServiceClient()
//    без жодного мережевого виклику. "@/lib/telegram-webhook" — той самий
//    модуль, що й у проді, лише резолвиться напряму (плейн Node не знає про
//    tsconfig path alias "@/*", це робить лише бандлер Next).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") {
    return nextResolve("next/server.js", context);
  }
  if (specifier === "@/lib/supabase/service") {
    return nextResolve(new URL("./telegram-webhook-route.mock-service.mts", import.meta.url).href, context);
  }
  if (specifier === "@/lib/telegram-webhook") {
    return nextResolve(new URL("./telegram-webhook.ts", import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}
