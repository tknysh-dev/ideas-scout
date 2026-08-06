import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { push, replace, paramsRef } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  paramsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => paramsRef.current,
}));

import TreeFilters from "./TreeFilters";
import { STATUS_META } from "@/lib/status";

const TRACKS = ["passive-income", "apps"];
const COUNTS = { "passive-income": 5, apps: 2 };
const ALL_STATUSES = Object.keys(STATUS_META);

beforeEach(() => {
  paramsRef.current = new URLSearchParams();
  push.mockClear();
  replace.mockClear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("TreeFilters — фільтр статусів", () => {
  test("без параметра status у URL — усі статуси вибрані, підпис «Усі»", () => {
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    expect(screen.getByText("Усі")).toBeDefined();
  });

  test("status=&#39;&#39; у URL — жодного статусу не вибрано", () => {
    paramsRef.current = new URLSearchParams("status=");
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    expect(screen.getByText("Нічого не вибрано")).toBeDefined();
  });

  test("зняття однієї галочки — навігація з рештою статусів і запис у localStorage", () => {
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Статус:/ }));
    const firstStatusLabel = STATUS_META[ALL_STATUSES[0] as keyof typeof STATUS_META].label;
    fireEvent.click(screen.getByLabelText(firstStatusLabel));

    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    const sent = new URLSearchParams(url.split("?")[1]);
    const remaining = sent.get("status")!.split(",");
    expect(remaining).toEqual(ALL_STATUSES.slice(1));
    expect(window.localStorage.getItem("ideas-scout:status-filter:passive-income")).toBe(
      remaining.join(","),
    );
  });

  test("«Зняти всі» / «Вибрати всі» перемикає весь список одразу", () => {
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Статус:/ }));
    fireEvent.click(screen.getByText("Зняти всі"));

    const url = push.mock.calls[0][0] as string;
    const sent = new URLSearchParams(url.split("?")[1]);
    expect(sent.get("status")).toBe("");
  });

  test("1-2 вибраних статуси (включно з невідомим id поза словником) — підпис виводить самі мітки", () => {
    // selected бере значення прямо з URL без звірки зі словником статусів,
    // тож "unknown" тут — валідний вхід, а не помилка тесту.
    paramsRef.current = new URLSearchParams("status=unknown,new");
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    expect(screen.getByText("unknown, Нова")).toBeDefined();
  });

  test("3+ вибраних, але не всі — підпис «Вибрано N»", () => {
    const four = ALL_STATUSES.slice(0, 4).join(",");
    paramsRef.current = new URLSearchParams(`status=${four}`);
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    expect(screen.getByText("Вибрано 4")).toBeDefined();
  });

  test("галочка на ще не вибраному статусі — додає його, зберігаючи порядок словника", () => {
    paramsRef.current = new URLSearchParams("status=analyzing,rejected");
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Статус:/ }));
    const newLabel = STATUS_META.new.label;
    fireEvent.click(screen.getByLabelText(newLabel));

    const url = push.mock.calls[0][0] as string;
    const sent = new URLSearchParams(url.split("?")[1]);
    const remaining = sent.get("status")!.split(",");
    expect(remaining).toEqual(
      ALL_STATUSES.filter((s) => s === "new" || ["analyzing", "rejected"].includes(s)),
    );
  });

  test("«Вибрати всі» з нуля вибраних — навігація з усіма статусами", () => {
    paramsRef.current = new URLSearchParams("status=");
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Статус:/ }));
    expect(screen.getByText("Вибрати всі")).toBeDefined();
    fireEvent.click(screen.getByText("Вибрати всі"));

    const url = push.mock.calls[0][0] as string;
    const sent = new URLSearchParams(url.split("?")[1]);
    expect(sent.get("status")!.split(",")).toEqual(ALL_STATUSES);
  });
});

describe("TreeFilters — треки", () => {
  test("активний трек визначається параметром track, інакше перший зі списку", () => {
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    const active = screen.getByRole("button", { name: /Пасивний дохід|passive-income/ });
    expect(active.className).toContain("border-accent");
  });

  test("перемикання треку читає збережений фільтр цього треку з localStorage", () => {
    window.localStorage.setItem("ideas-scout:status-filter:apps", "new,rejected");
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    const appsTab = screen.getAllByRole("button").find((b) => b.textContent?.includes("2"));
    fireEvent.click(appsTab!);

    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    const sent = new URLSearchParams(url.split("?")[1]);
    expect(sent.get("track")).toBe("apps");
    expect(sent.get("status")).toBe("new,rejected");
  });

  test("перемикання на трек без збереженого фільтра — status видаляється з URL, а не встановлюється в порожній", () => {
    // Без запису в localStorage для "apps" navigate отримує status: null —
    // саме ця гілка (delete замість set) досі не мала тесту.
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    const appsTab = screen.getAllByRole("button").find((b) => b.textContent?.includes("2"));
    fireEvent.click(appsTab!);

    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    const sent = new URLSearchParams(url.split("?")[1]);
    expect(sent.get("track")).toBe("apps");
    expect(sent.has("status")).toBe(false);
  });

  test("трек без запису в counts — лічильник показує 0, а не падає", () => {
    render(<TreeFilters tracks={["passive-income", "new-track"]} counts={{ "passive-income": 5 }} />);
    const tab = screen.getByRole("button", { name: /new-track/ });
    expect(tab.textContent).toContain("0");
  });

  test("порожній список треків — трек за замовчуванням «passive-income», а не збій", () => {
    // tracks[0] відсутній -> track падає до жорстко заданого фолбеку. Перевіряємо
    // це опосередковано: якщо в localStorage лежить фільтр саме під ключем
    // "passive-income", ефект монтування підхопить його через router.replace.
    window.localStorage.setItem("ideas-scout:status-filter:passive-income", "new");
    render(<TreeFilters tracks={[]} counts={{}} />);

    expect(replace).toHaveBeenCalledTimes(1);
    const url = replace.mock.calls[0][0] as string;
    expect(new URLSearchParams(url.split("?")[1]).get("status")).toBe("new");
  });
});

describe("TreeFilters — підстановка збереженого фільтра при монтуванні", () => {
  test("URL без status і збережений фільтр у localStorage — replace (не push) з тим фільтром", () => {
    window.localStorage.setItem("ideas-scout:status-filter:passive-income", "analyzing,rejected");
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);

    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    const url = replace.mock.calls[0][0] as string;
    expect(new URLSearchParams(url.split("?")[1]).get("status")).toBe("analyzing,rejected");
  });

  test("URL без status і без запису в localStorage — жодної навігації", () => {
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("TreeFilters — випадне меню закривається кліком поза ним", () => {
  test("mousedown поза меню закриває його", () => {
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Статус:/ }));
    expect(screen.getByText("Зняти всі")).toBeDefined();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("Зняти всі")).toBeNull();
  });

  test("mousedown усередині меню не закриває його", () => {
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    fireEvent.click(screen.getByRole("button", { name: /Статус:/ }));
    const menuItem = screen.getByText("Зняти всі");

    fireEvent.mouseDown(menuItem);
    expect(screen.getByText("Зняти всі")).toBeDefined();
  });
});

describe("TreeFilters — сортування", () => {
  test("зміна select сортування викликає навігацію з sort", () => {
    render(<TreeFilters tracks={TRACKS} counts={COUNTS} />);
    fireEvent.change(screen.getByDisplayValue("Спочатку нові"), {
      target: { value: "asc" },
    });
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(new URLSearchParams(url.split("?")[1]).get("sort")).toBe("asc");
  });
});
