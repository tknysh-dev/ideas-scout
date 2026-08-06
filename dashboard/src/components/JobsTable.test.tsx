// JobsTable рендерить <IdeaText> для колонки типу — а IdeaText асинхронний
// серверний компонент (тягне idea-refs.server.ts -> "server-only"). Клієнтський
// react-dom (яким рендерить RTL) не вміє змонтувати вкладений async-компонент
// (падає/зависає на suspend), тож підміняємо IdeaText на синхронний стаб:
// саму розмітку лінків тестує idea-refs-server.test.tsx/linkify.test.tsx,
// тут під тестом лише логіка самого JobsTable (jobLabel, статуси, форматування).
import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/components/IdeaText", () => ({
  default: ({ text }: { text: string }) => <>{text}</>,
}));

import JobsTable from "@/components/JobsTable";
import type { JobRow, JobStatus } from "@/lib/types";

function job(overrides: Partial<JobRow> & { id: string }): JobRow {
  return {
    type: "deep_research_synthesis",
    payload: null,
    status: "pending",
    requested_by: "owner",
    attempt_count: 0,
    max_attempts: 3,
    created_at: "2026-01-01T10:00:00.000Z",
    started_at: null,
    finished_at: null,
    worker_id: null,
    run_id: null,
    last_error: null,
    ...overrides,
  };
}

function dataRows(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell");
}

describe("JobsTable — порожня черга", () => {
  test("jobs=[] — таблиця рендериться без жодного рядка даних", () => {
    render(<JobsTable jobs={[]} />);
    // Заголовок таблиці лишається, рядків tbody немає.
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});

describe("JobsTable — усі відомі статуси", () => {
  const CASES: Array<{ status: JobStatus; label: string }> = [
    { status: "pending", label: "У черзі" },
    { status: "running", label: "Виконується" },
    { status: "succeeded", label: "Успішно" },
    { status: "failed", label: "Помилка" },
    { status: "cancelled", label: "Скасовано" },
  ];

  test.each(CASES)("статус $status показує підпис «$label»", ({ status, label }) => {
    render(<JobsTable jobs={[job({ id: "job-1", status })]} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  test("невідомий статус поза словником STATUS_META — компонент не падає, показує сирий статус (jobStatusMeta мирує фолбек із statusMeta())", () => {
    const unknown = job({ id: "job-1", status: "queued" as JobStatus });
    expect(() => render(<JobsTable jobs={[unknown]} />)).not.toThrow();
    expect(screen.getByText("queued")).toBeDefined();
  });
});

describe("JobsTable — worker_id / run_id nullable", () => {
  test("worker_id і run_id відсутні (null) — обидва показують «—»", () => {
    render(<JobsTable jobs={[job({ id: "job-1", worker_id: null, run_id: null })]} />);
    const row = screen.getAllByRole("row")[1];
    const cells = dataRows(row);
    expect(cells[4].textContent).toBe("—");
    expect(cells[5].textContent).toBe("—");
  });

  test("worker_id і run_id задані — показують власне значення", () => {
    render(
      <JobsTable
        jobs={[job({ id: "job-1", worker_id: "worker-42", run_id: "run-abc-123" })]}
      />,
    );
    const row = screen.getAllByRole("row")[1];
    const cells = dataRows(row);
    expect(cells[4].textContent).toBe("worker-42");
    expect(cells[5].textContent).toBe("run-abc-123");
  });
});

describe("JobsTable — last_error і title", () => {
  test("last_error відсутній (null) — комірка статусу без атрибута title", () => {
    render(<JobsTable jobs={[job({ id: "job-1", last_error: null })]} />);
    const row = screen.getAllByRole("row")[1];
    const statusCell = dataRows(row)[2];
    expect(statusCell.hasAttribute("title")).toBe(false);
  });

  test("last_error заданий — title комірки статусу містить текст помилки", () => {
    render(<JobsTable jobs={[job({ id: "job-1", last_error: "Тайм-аут запиту до API" })]} />);
    const row = screen.getAllByRole("row")[1];
    const statusCell = dataRows(row)[2];
    expect(statusCell.getAttribute("title")).toBe("Тайм-аут запиту до API");
  });
});

describe("JobsTable — jobLabel: тип job'а", () => {
  test("невідомий тип (поза JOB_TYPE_LABELS) — показується сирий job.type", () => {
    render(<JobsTable jobs={[job({ id: "job-1", type: "unknown_job_type" })]} />);
    expect(screen.getByText("unknown_job_type")).toBeDefined();
  });

  test("відомий тип, payload=null — лише базовий підпис, без ідентифікатора ідеї", () => {
    render(<JobsTable jobs={[job({ id: "job-1", type: "deep_research_synthesis", payload: null })]} />);
    expect(screen.getByText("Синтез глибокого дослідження")).toBeDefined();
  });

  test("відомий тип, payload не є обʼєктом (рядок) — лише базовий підпис", () => {
    render(
      <JobsTable
        jobs={[job({ id: "job-1", type: "deep_research_synthesis", payload: "не обʼєкт" })]}
      />,
    );
    expect(screen.getByText("Синтез глибокого дослідження")).toBeDefined();
  });

  test("відомий тип, payload — обʼєкт без idea_id — лише базовий підпис", () => {
    render(
      <JobsTable
        jobs={[job({ id: "job-1", type: "deep_research_synthesis", payload: { other: "поле" } })]}
      />,
    );
    expect(screen.getByText("Синтез глибокого дослідження")).toBeDefined();
  });

  test("відомий тип, payload.idea_id не рядок (число) — лише базовий підпис", () => {
    render(
      <JobsTable
        jobs={[job({ id: "job-1", type: "deep_research_synthesis", payload: { idea_id: 42 } })]}
      />,
    );
    expect(screen.getByText("Синтез глибокого дослідження")).toBeDefined();
  });

  test("відомий тип, payload.idea_id — рядок — підпис доповнюється id ідеї", () => {
    render(
      <JobsTable
        jobs={[
          job({ id: "job-1", type: "deep_research_synthesis", payload: { idea_id: "PI-0007" } }),
        ]}
      />,
    );
    expect(screen.getByText("Синтез глибокого дослідження · PI-0007")).toBeDefined();
  });
});

describe("JobsTable — attempt_count/max_attempts і черга з кількох job'ів", () => {
  test("межові значення: 0/1 і велике число спроб", () => {
    render(
      <JobsTable
        jobs={[
          job({ id: "job-1", attempt_count: 0, max_attempts: 1 }),
          job({ id: "job-2", attempt_count: 999, max_attempts: 999 }),
        ]}
      />,
    );
    expect(screen.getByText("0/1")).toBeDefined();
    expect(screen.getByText("999/999")).toBeDefined();
  });

  test("черга з одного job'а — рівно один рядок даних", () => {
    render(<JobsTable jobs={[job({ id: "job-1" })]} />);
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  test("черга з кількох job'ів — рядок на кожен, у порядку вхідного масиву", () => {
    render(
      <JobsTable
        jobs={[
          job({ id: "job-1", type: "type-a" }),
          job({ id: "job-2", type: "type-b" }),
          job({ id: "job-3", type: "type-c" }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(dataRows(rows[0])[1].textContent).toBe("type-a");
    expect(dataRows(rows[1])[1].textContent).toBe("type-b");
    expect(dataRows(rows[2])[1].textContent).toBe("type-c");
  });
});

describe("JobsTable — довгий текст типу job'а", () => {
  test("довгий job.type (поза словником) рендериться повністю, без обрізання в DOM", () => {
    const longType = "дуже_довгий_нестандартний_тип_джоба_який_не_описаний_у_словнику_підписів";
    render(<JobsTable jobs={[job({ id: "job-1", type: longType })]} />);
    expect(screen.getByText(longType)).toBeDefined();
  });
});
