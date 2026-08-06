// RunsTable — клієнтський компонент без залежності від "server-only", тож на
// відміну від CriteriaAnalysis/CompetitorsSection монтуємо реально через
// render()+screen (той самий підхід, що й JobsTable.test.tsx/DeepResearchTabs.test.tsx).
import { describe, expect, test } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import RunsTable from "@/components/RunsTable";
import type { RunRow } from "@/lib/types";

function run(overrides: Partial<RunRow> & { run_id: string }): RunRow {
  return {
    job: "scout",
    track: null,
    provider: "openai",
    started_at: "2026-01-01T10:00:00.000Z",
    finished_at: null,
    status: "ok",
    errors: null,
    token_usage: null,
    processed_urls: [],
    notes: null,
    meta: null,
    ...overrides,
  };
}

function dataCells(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("cell");
}

describe("RunsTable — порожній список прогонів", () => {
  test("runs=[] — таблиця рендериться без жодного рядка даних", () => {
    render(<RunsTable runs={[]} />);
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});

describe("RunsTable — провайдер (nullable)", () => {
  test("provider=null — комірка показує «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", provider: null })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[2].textContent).toBe("—");
  });

  test("provider заданий — показує власне значення (довільний рядок, не зі словника)", () => {
    render(<RunsTable runs={[run({ run_id: "r1", provider: "custom-provider-x" })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[2].textContent).toBe("custom-provider-x");
  });
});

describe("RunsTable — статус (STATUS_TONE)", () => {
  const KNOWN: RunRow["status"][] = ["ok", "error", "running", "dry_run", "skipped_work_hours"];

  test.each(KNOWN)("відомий статус '%s' показується як є", (status) => {
    render(<RunsTable runs={[run({ run_id: "r1", status })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[4].textContent).toBe(status);
  });

  test("status=null — комірка показує «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", status: null })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[4].textContent).toBe("—");
  });

  // Задокументована сумнівна поведінка: STATUS_TONE — не типізований union, а
  // Record<string, string> без явного словника дозволених значень (на відміну
  // від RunRow["status"]: string | null у types.ts — обмеження взагалі немає
  // на рівні типів). Невідомий статус не падає (фолбек тону "text-ink"), і
  // рядок статусу показує сире значення з БД — на відміну від JobsTable, де
  // невідомий статус валить рендер повністю.
  test("невідомий статус (поза STATUS_TONE) — компонент не падає, показує сире значення з фолбек-тоном", () => {
    expect(() =>
      render(<RunsTable runs={[run({ run_id: "r1", status: "queued" })]} />),
    ).not.toThrow();
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[4].textContent).toBe("queued");
  });
});

describe("RunsTable — помилки (колонка «Помилки», RunErrors)", () => {
  test("errors=null — колонка показує «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", errors: null })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[6].textContent).toBe("—");
  });

  test("errors=undefined — колонка показує «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", errors: undefined })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[6].textContent).toBe("—");
  });

  test("errors=[] (порожній масив) — колонка показує «—», а не 0", () => {
    render(<RunsTable runs={[run({ run_id: "r1", errors: [] })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[6].textContent).toBe("—");
  });

  test("errors — не масив (обʼєкт) — трактується як порожній список, «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", errors: { message: "боом" } })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[6].textContent).toBe("—");
  });

  test("errors — не масив (рядок) — трактується як порожній список, «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", errors: "щось пішло не так" })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[6].textContent).toBe("—");
  });

  test("errors — непорожній масив — колонка показує кількість елементів", () => {
    render(<RunsTable runs={[run({ run_id: "r1", errors: ["e1", "e2", "e3"] })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[6].textContent).toBe("3");
  });
});

describe("RunsTable — токени (колонка «Токени», TokenUsage)", () => {
  test("token_usage=null — «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", token_usage: null })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[5].textContent).toBe("—");
  });

  test("token_usage=undefined — «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", token_usage: undefined })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[5].textContent).toBe("—");
  });

  test("token_usage — рядок (не обʼєкт) — «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", token_usage: "42 tokens" })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[5].textContent).toBe("—");
  });

  test("token_usage — число (не обʼєкт) — «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", token_usage: 42 })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[5].textContent).toBe("—");
  });

  test("token_usage={} (порожній обʼєкт) — «—»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", token_usage: {} })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[5].textContent).toBe("—");
  });

  test("token_usage з ключами — показує «ключ: значення» через кому, з межовими числами (0, відʼємне, дуже велике)", () => {
    render(
      <RunsTable
        runs={[
          run({
            run_id: "r1",
            token_usage: { prompt: 0, completion: -1, total: 999999999 },
          }),
        ]}
      />,
    );
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[5].textContent).toBe("prompt: 0, completion: -1, total: 999999999");
  });

  test("token_usage — непорожній масив (не план-обʼєкт) — «—», а не розбір через Object.entries за індексами", () => {
    render(<RunsTable runs={[run({ run_id: "r1", token_usage: ["a", "b"] })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[5].textContent).toBe("—");
  });

  test("token_usage — порожній масив — «—» (той самий шлях, що й порожній обʼєкт)", () => {
    render(<RunsTable runs={[run({ run_id: "r1", token_usage: [] })]} />);
    const cells = dataCells(screen.getAllByRole("row")[1]);
    expect(cells[5].textContent).toBe("—");
  });
});

describe("RunsTable — розгортання рядка кліком", () => {
  test("клік по рядку розкриває деталі, повторний клік — згортає", () => {
    render(<RunsTable runs={[run({ run_id: "r1", notes: "нотатка" })]} />);
    expect(screen.queryByText("нотатка")).toBeNull();

    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("нотатка")).toBeDefined();

    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.queryByText("нотатка")).toBeNull();
  });

  test("розгорнутий лише один рядок одночасно — клік по іншому рядку перемикає, а не додає другий", () => {
    render(
      <RunsTable
        runs={[
          run({ run_id: "r1", notes: "перший" }),
          run({ run_id: "r2", notes: "другий" }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("row");
    fireEvent.click(rows[1]);
    expect(screen.getByText("перший")).toBeDefined();
    expect(screen.queryByText("другий")).toBeNull();

    fireEvent.click(rows[2]);
    expect(screen.queryByText("перший")).toBeNull();
    expect(screen.getByText("другий")).toBeDefined();
  });
});

describe("RunsTable — деталі: оброблені URL", () => {
  test("processed_urls=[] — лічильник (0), текст «Немає» замість списку", () => {
    render(<RunsTable runs={[run({ run_id: "r1", processed_urls: [] })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("Оброблені URL (0)")).toBeDefined();
    expect(screen.getByText("Немає")).toBeDefined();
  });

  test("processed_urls з одним елементом — список з одним <li>", () => {
    render(<RunsTable runs={[run({ run_id: "r1", processed_urls: ["https://a.example"] })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("Оброблені URL (1)")).toBeDefined();
    expect(screen.getByText("https://a.example")).toBeDefined();
  });

  test("processed_urls з кількома елементами — усі рендеряться списком", () => {
    render(
      <RunsTable
        runs={[
          run({
            run_id: "r1",
            processed_urls: ["https://a.example", "https://b.example", "https://c.example"],
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("Оброблені URL (3)")).toBeDefined();
    expect(screen.getByText("https://a.example")).toBeDefined();
    expect(screen.getByText("https://b.example")).toBeDefined();
    expect(screen.getByText("https://c.example")).toBeDefined();
  });

  // Тип processed_urls — string[] (не nullable), але код захищається
  // optional chaining (`run.processed_urls?.length`), тож перевіряємо й
  // рантайм-значення, які TS формально забороняє (БД може віддати null).
  test("processed_urls=null у рантаймі (всупереч типу) — лічильник 0, «Немає» замість падіння", () => {
    const withNullUrls = run({ run_id: "r1" }) as RunRow;
    (withNullUrls as unknown as { processed_urls: null }).processed_urls = null;
    expect(() => render(<RunsTable runs={[withNullUrls]} />)).not.toThrow();
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("Оброблені URL (0)")).toBeDefined();
    expect(screen.getByText("Немає")).toBeDefined();
  });
});

describe("RunsTable — деталі: метадані (JSON)", () => {
  test("meta=null — показує «{}»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", meta: null })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("{}")).toBeDefined();
  });

  test("meta=undefined — показує «{}»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", meta: undefined })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("{}")).toBeDefined();
  });

  test("meta={} (явно порожній обʼєкт) — показує «{}»", () => {
    render(<RunsTable runs={[run({ run_id: "r1", meta: {} })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("{}")).toBeDefined();
  });

  test("meta з несподіваними ключами — рендериться як є, без фільтрації", () => {
    render(
      <RunsTable
        runs={[run({ run_id: "r1", meta: { unexpected_key: "value", nested: { a: 1 } } })]}
      />,
    );
    fireEvent.click(screen.getAllByRole("row")[1]);
    const pre = screen.getByText(/unexpected_key/);
    expect(pre.textContent).toContain('"unexpected_key": "value"');
    expect(pre.textContent).toContain('"nested"');
  });
});

describe("RunsTable — деталі: нотатки (notes)", () => {
  test("notes=null — блок нотаток не рендериться", () => {
    render(<RunsTable runs={[run({ run_id: "r1", notes: null })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.queryByText("Нотатки")).toBeNull();
  });

  // Тип notes — string | null; порожній рядок формально дозволений типом, і
  // код (`run.notes && ...`) трактує його як falsy — той самий шлях, що й
  // null, хоча семантично це «є нотатка, просто порожня».
  test("notes='' (порожній рядок) — блок нотаток теж не рендериться (falsy)", () => {
    render(<RunsTable runs={[run({ run_id: "r1", notes: "" })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.queryByText("Нотатки")).toBeNull();
  });

  test("notes непорожній — блок «Нотатки» з текстом рендериться", () => {
    render(<RunsTable runs={[run({ run_id: "r1", notes: "важливий контекст прогону" })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(screen.getByText("Нотатки")).toBeDefined();
    expect(screen.getByText("важливий контекст прогону")).toBeDefined();
  });
});

describe("RunsTable — деталі: блок помилок (errors, розгорнутий JSON)", () => {
  // "Помилки" — і назва колонки в <th>, і заголовок цього блоку, тож рахуємо
  // входження тексту, а не шукаємо єдиний елемент.
  function errorHeadings() {
    return screen.getAllByText("Помилки").filter((el) => el.tagName !== "TH");
  }

  test("errors=null — блок «Помилки» в деталях не рендериться", () => {
    render(<RunsTable runs={[run({ run_id: "r1", errors: null })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(errorHeadings()).toHaveLength(0);
  });

  test("errors=[] (порожній масив) — блок «Помилки» не рендериться", () => {
    render(<RunsTable runs={[run({ run_id: "r1", errors: [] })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(errorHeadings()).toHaveLength(0);
  });

  test("errors — не масив (обʼєкт) — блок «Помилки» не рендериться", () => {
    render(<RunsTable runs={[run({ run_id: "r1", errors: { message: "x" } })]} />);
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(errorHeadings()).toHaveLength(0);
  });

  test("errors — непорожній масив із довгим текстом і розміткою — блок «Помилки» рендерить повний JSON", () => {
    const longError = "TimeoutError: " + "деталі стеку викликів дуже довгі ".repeat(30);
    render(
      <RunsTable
        runs={[
          run({
            run_id: "r1",
            errors: [longError, "<script>alert(1)</script>", "друга помилка"],
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getAllByRole("row")[1]);
    expect(errorHeadings()).toHaveLength(1);
    const pre = screen.getByText(/TimeoutError/);
    expect(pre.textContent).toContain(longError);
    expect(pre.textContent).toContain("<script>alert(1)</script>");
    expect(pre.textContent).toContain("друга помилка");
  });
});

describe("RunsTable — кілька прогонів у списку", () => {
  test("список з одного прогону — рівно один рядок даних", () => {
    render(<RunsTable runs={[run({ run_id: "r1" })]} />);
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  test("кілька прогонів — рядок на кожен, у порядку вхідного масиву", () => {
    render(
      <RunsTable
        runs={[
          run({ run_id: "r1", job: "job-a" }),
          run({ run_id: "r2", job: "job-b" }),
          run({ run_id: "r3", job: "job-c" }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(dataCells(rows[0])[1].textContent).toBe("job-a");
    expect(dataCells(rows[1])[1].textContent).toBe("job-b");
    expect(dataCells(rows[2])[1].textContent).toBe("job-c");
  });
});
