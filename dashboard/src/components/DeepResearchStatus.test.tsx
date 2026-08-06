// DeepResearchStatus — клієнтський компонент (хуки useEffect/useRouter), тож
// на відміну від CompetitorsSection/CriteriaAnalysis тут монтуємо реально
// через render()+screen: жодного Card чи іншого асинхронного серверного
// компонента всередині немає.
const { routerRefresh } = vi.hoisted(() => ({ routerRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DeepResearchStatus, { type ActiveSynthesisJob } from "./DeepResearchStatus";
import { formatDateTime } from "@/lib/dates";

const POLL_MS = 10_000;

function job(overrides: Partial<ActiveSynthesisJob> & { status: ActiveSynthesisJob["status"] }): ActiveSynthesisJob {
  return {
    created_at: "2026-01-01T00:00:00Z",
    run_id: null,
    last_error: null,
    ...overrides,
  };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
}

beforeEach(() => {
  routerRefresh.mockReset();
  setHidden(false);
});

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

describe("DeepResearchStatus — активні статуси (pending/running)", () => {
  test("status='pending' -> заголовок 'Синтез у черзі', час постановки, посилання на чергу без run_id", () => {
    render(<DeepResearchStatus job={job({ status: "pending", created_at: "2026-01-02T10:00:00Z" })} />);
    expect(screen.getByText("Синтез у черзі")).toBeDefined();
    expect(screen.getByText(new RegExp(formatDateTime("2026-01-02T10:00:00Z")))).toBeDefined();
    const link = screen.getByRole("link", { name: "Черга M1" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/runs?tab=queue");
  });

  test("status='running', run_id заданий -> заголовок 'Синтез виконується', посилання на лог конкретного прогону", () => {
    render(<DeepResearchStatus job={job({ status: "running", run_id: "R-1" })} />);
    expect(screen.getByText("Синтез виконується")).toBeDefined();
    const link = screen.getByRole("link", { name: "Лог прогону R-1" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/runs?tab=history");
  });
});

describe("DeepResearchStatus — завершені статуси (failed/cancelled)", () => {
  test("status='failed', last_error=null, run_id=null -> плашка 'Синтез не вдався', 'востаннє спробували', без блоку помилки, лінк на чергу", () => {
    render(<DeepResearchStatus job={job({ status: "failed" })} />);
    expect(screen.getByText("Синтез не вдався")).toBeDefined();
    expect(screen.getByText(/востаннє спробували/)).toBeDefined();
    expect(screen.getByText(/завершився помилкою після всіх повторних спроб/)).toBeDefined();
    const link = screen.getByRole("link", { name: "Черга M1" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/runs?tab=queue");
  });

  test("status='cancelled', last_error заданий, run_id заданий -> плашка 'Синтез скасовано', 'поставлено', блок з текстом помилки, лінк на лог прогону", () => {
    render(
      <DeepResearchStatus
        job={job({ status: "cancelled", last_error: "worker timeout", run_id: "R-2" })}
      />,
    );
    expect(screen.getByText("Синтез скасовано")).toBeDefined();
    expect(screen.getByText(/^поставлено/)).toBeDefined();
    expect(screen.getByText(/скасували, не діждавшись результату/)).toBeDefined();
    expect(screen.getByText("worker timeout")).toBeDefined();
    const link = screen.getByRole("link", { name: "Лог прогону R-2" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/runs?tab=history");
  });

  // Сумнівна поведінка: ActiveSynthesisJob["status"] типізований як union із
  // чотирьох значень, але рантайм-дані з БД цим не перевіряються. Значення
  // поза словником не потрапляє в ACTIVE_STATUSES (isActive=false), а далі
  // `failed = job.status === "failed"` теж хибне для будь-якого невідомого
  // рядка — тож невідомий статус мовчки показується як "скасовано", хоча
  // насправді це може бути зовсім інший (майбутній) статус синтезу.
  test("невідомий статус (не зі словника) -> трактується як 'скасовано', компонент не падає", () => {
    render(
      <DeepResearchStatus
        job={job({ status: "archived" as unknown as ActiveSynthesisJob["status"] })}
      />,
    );
    expect(screen.getByText("Синтез скасовано")).toBeDefined();
  });
});

describe("DeepResearchStatus — авто-оновлення сторінки поки активний", () => {
  test("активний job -> через POLL_MS викликає router.refresh(), якщо вкладка видима", () => {
    vi.useFakeTimers();
    render(<DeepResearchStatus job={job({ status: "running" })} />);
    vi.advanceTimersByTime(POLL_MS);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  test("активний job, вкладка схована (document.hidden=true) -> router.refresh() не викликається", () => {
    setHidden(true);
    vi.useFakeTimers();
    render(<DeepResearchStatus job={job({ status: "pending" })} />);
    vi.advanceTimersByTime(POLL_MS);
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  test("неактивний job (failed) -> інтервал не заводиться, router.refresh() не викликається навіть через POLL_MS", () => {
    vi.useFakeTimers();
    render(<DeepResearchStatus job={job({ status: "failed" })} />);
    vi.advanceTimersByTime(POLL_MS * 2);
    expect(routerRefresh).not.toHaveBeenCalled();
  });
});
