import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// src/lib/*.test.mts лишається на node --test (npm test жене обидва раннери
// послідовно) — тут лише компоненти, інакше node:test-файли підхопились би
// вдруге під vitest і впали б на власному API.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    include: ["src/components/**/*.test.tsx"],
    setupFiles: ["./src/components/test-setup.ts"],
    coverage: {
      provider: "v8",
      // Явний include (а не лише exclude) вмикає в vitest 4 облік і файлів,
      // яких жоден тест не імпортував (0%) — саме вони цікавлять найбільше.
      // v8-провайдер робить це статичним аналізом AST, не виконанням файлу,
      // тож server-only/next-серверні модулі не падають при зборі покриття.
      include: ["src/**/*.{ts,tsx,mts}"],
      exclude: [
        "src/**/*.test.{ts,tsx,mts}",
        "src/**/*.d.ts",
        "src/components/test-setup.ts",
        // тестова інфраструктура telegram-webhook-route.test.mts, не прод-код
        "src/lib/telegram-webhook-route.mock-service.mts",
        "src/lib/telegram-webhook-route.hooks.mjs",
      ],
      reportsDirectory: "coverage/vitest",
      reporter: ["text", "json"],
    },
  },
});
