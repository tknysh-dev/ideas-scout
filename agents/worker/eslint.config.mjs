// eslint.config.mjs — flat-конфіг ESLint для agents/worker: чистий Node.js
// ESM без React і TypeScript, тож базовий @eslint/js recommended плюс
// правила під Node. Ловимо баги (невикористані змінні, no-undef, обіцянки
// без await, недосяжний код, дублікати ключів), не стиль — prettier у
// репозиторії немає.
import js from "@eslint/js";
import noFloatingPromise from "eslint-plugin-no-floating-promise";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "no-floating-promise": noFloatingPromise,
    },
    rules: {
      "no-floating-promise/no-floating-promise": "error",
    },
  },
];
