import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest ізолює файли, але не тести всередині файлу: підмінені глобали
// (matchMedia), фейкові таймери й стан моків протікали між ними. Саме звідси
// плаваючий провал, що ловився лише в повному прогоні й ніколи поодинці.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
});

// Node 22+ оголошує власний глобал localStorage, який без прапорця запуску
// --localstorage-file обчислюється в undefined. У jsdom-середовищі vitest він
// перемагає той, що дає jsdom, і window.localStorage стає undefined — а це
// рівно те, на чому тримається TreeFilters (збережений фільтр статусів).
// Симптом непропорційно масштабний: падають усі 588 тестів компонентів із
// «Cannot read properties of undefined (reading 'getItem')», хоч сам код
// справний. Тестам потрібні лише get/set/remove/clear, тому кладемо мінімальну
// реалізацію в пам'яті — вона ж дає ізоляцію між тестами через clear() вище.
if (!window.localStorage) {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(window, "localStorage", { value: memoryStorage, configurable: true });
}

// jsdom не реалізує ResizeObserver — CollapsibleBody на нього зав'язаний.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
