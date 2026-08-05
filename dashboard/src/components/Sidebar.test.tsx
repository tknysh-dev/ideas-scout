import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { pathname, logout } = vi.hoisted(() => ({
  pathname: { current: "/" },
  logout: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));
// logout — серверна дія, тягне за собою next-auth; у компонентному тесті
// достатньо форми, що її викликає, тож саму дію підміняємо заглушкою.
vi.mock("@/lib/actions/session", () => ({ logout }));

import Sidebar from "./Sidebar";

beforeEach(() => {
  pathname.current = "/";
});

describe("Sidebar", () => {
  test("на /login нічого не рендерить", () => {
    pathname.current = "/login";
    const { container } = render(<Sidebar />);
    expect(container.firstChild).toBeNull();
  });

  test("активне посилання визначається поточним шляхом", () => {
    pathname.current = "/decisions";
    render(<Sidebar />);
    const link = screen.getByRole("link", { name: /Рішення/ });
    expect(link.className).toContain("text-accent");
    const board = screen.getByRole("link", { name: /Дошка/ });
    expect(board.className).not.toContain("text-accent");
  });

  test("бейдж очікуваних рішень показується лише коли є що показати", () => {
    const { rerender } = render(<Sidebar pendingDecisions={0} />);
    expect(screen.queryByText("0")).toBeNull();
    rerender(<Sidebar pendingDecisions={4} />);
    expect(screen.getByText("4")).toBeDefined();
  });

  test("authDisabled — підказка про dev замість кнопки виходу", () => {
    render(<Sidebar authDisabled />);
    expect(screen.getByText("Авторизація вимкнена (dev)")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Вийти" })).toBeNull();
  });

  test("без authDisabled — є форма виходу", () => {
    render(<Sidebar />);
    expect(screen.getByRole("button", { name: "Вийти" })).toBeDefined();
  });

  test("мобільна шторка відкривається кнопкою й закривається при зміні шляху", () => {
    const { rerender } = render(<Sidebar />);
    const aside = document.querySelector("aside")!;
    expect(aside.className).toContain("-translate-x-full");

    fireEvent.click(screen.getByRole("button", { name: "Відкрити меню" }));
    expect(aside.className).toContain("translate-x-0");
    expect(aside.className).not.toContain("-translate-x-full");

    // Навігація на нову сторінку — usePathname віддає інше значення, Sidebar
    // сам скидає open, щоб шторка не лишалась розгорнутою поверх нової сторінки.
    pathname.current = "/runs";
    rerender(<Sidebar />);
    expect(aside.className).toContain("-translate-x-full");
  });

  test("клік по затемненню закриває шторку", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Відкрити меню" }));
    const aside = document.querySelector("aside")!;
    expect(aside.className).toContain("translate-x-0");

    fireEvent.click(screen.getByRole("button", { name: "Закрити меню" }));
    expect(aside.className).toContain("-translate-x-full");
  });
});
