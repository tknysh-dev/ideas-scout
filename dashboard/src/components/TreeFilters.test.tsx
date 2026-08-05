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
