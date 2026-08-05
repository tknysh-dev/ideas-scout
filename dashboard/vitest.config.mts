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
  },
});
