import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import Pagination from "./Pagination";

describe("Pagination", () => {
  test("одна сторінка — лише лічильник, без стрілок", () => {
    render(<Pagination page={1} pageCount={1} total={3} hrefFor={(p) => `/?page=${p}`} />);
    expect(screen.getByText("Записів: 3")).toBeDefined();
    expect(screen.queryByText("← Назад")).toBeNull();
    expect(screen.queryByText("Далі →")).toBeNull();
  });

  test("перша сторінка — «Назад» вимкнена (span, не посилання)", () => {
    render(<Pagination page={1} pageCount={3} total={30} hrefFor={(p) => `/?page=${p}`} />);
    const back = screen.getByText("← Назад");
    expect(back.tagName).toBe("SPAN");
    const next = screen.getByText("Далі →");
    expect(next.tagName).toBe("A");
    expect(next.getAttribute("href")).toBe("/?page=2");
  });

  test("остання сторінка — «Далі» вимкнена", () => {
    render(<Pagination page={3} pageCount={3} total={30} hrefFor={(p) => `/?page=${p}`} />);
    expect(screen.getByText("Далі →").tagName).toBe("SPAN");
    const back = screen.getByText("← Назад");
    expect(back.tagName).toBe("A");
    expect(back.getAttribute("href")).toBe("/?page=2");
  });

  test("середня сторінка — обидві стрілки активні з правильними href", () => {
    render(<Pagination page={2} pageCount={5} total={50} hrefFor={(p) => `/?page=${p}`} />);
    expect(screen.getByText("← Назад").getAttribute("href")).toBe("/?page=1");
    expect(screen.getByText("Далі →").getAttribute("href")).toBe("/?page=3");
  });
});
