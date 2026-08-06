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
      // Тільки те, що vitest справді виконує: компоненти й сторінки. Раніше
      // тут стояло src/**, і це псувало зведений звіт: vitest інструментує
      // файли статичним аналізом AST, тож для src/lib/** (їх ганяє node --test)
      // він додавав власну карту гілок із нулем покриття. Карти від двох
      // парсерів не збігаються структурно, тому istanbul їх не об'єднував, а
      // ДОДАВАВ — 171 покрита гілка + 166 порожніх = 337, і 100% перетворювались
      // на 56%. Розділення за доменом прибирає перетин: lib міряє c8, решту —
      // vitest.
      include: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx,mts}",
        "src/**/*.d.ts",
        "src/components/test-setup.ts",
        // тестова інфраструктура telegram-webhook-route.test.mts, не прод-код
        "src/lib/telegram-webhook-route.mock-service.mts",
        "src/lib/telegram-webhook-route.hooks.mjs",
        // Хендлер вебхука покриває node --test через resolve-хук, тож його
        // міряє c8. Тут він має бути виключений, інакше карти двох парсерів
        // знову складуться, а не об'єднаються.
        "src/app/api/telegram/webhook/route.ts",
      ],
      reportsDirectory: "coverage/vitest",
      reporter: ["text", "json"],
    },
  },
});
