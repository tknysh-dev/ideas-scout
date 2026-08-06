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

// jsdom не реалізує ResizeObserver — CollapsibleBody на нього зав'язаний.
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
