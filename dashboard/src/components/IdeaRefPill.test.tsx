import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import IdeaRefPill from "./IdeaRefPill";
import type { IdeaRef } from "@/lib/idea-refs";
import type { IdeaStatus } from "@/lib/types";

function idea(overrides: Partial<IdeaRef> = {}): IdeaRef {
  return { id: "PI-0001", title: "Ідея про пасивний дохід", status: "new", summary: "Короткий опис", ...overrides };
}

// getBoundingClientRect у jsdom завжди повертає нулі — без цього мока
// openUpward і clamping тултіпа неможливо ані відтворити, ані перевірити.
function mockRect(overrides: Partial<DOMRect> = {}) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    top: 0,
    left: 0,
    right: 100,
    bottom: 20,
    toJSON() {
      return {};
    },
    ...overrides,
  } as DOMRect);
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
}

// Коли тултіп відкритий, у ньому є другий <a> (іконка "відкрити в новій
// вкладці") — тому беремо саме перше посилання, а не getByRole (яке впало б
// на неоднозначність).
function wrapperOf(): HTMLElement {
  return screen.getAllByRole("link")[0].parentElement as HTMLElement;
}

beforeEach(() => {
  setViewport(1024, 768);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IdeaRefPill — базовий рендер", () => {
  test("посилання веде на /ideas/{id} і показує id та заголовок", () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/ideas/PI-0001");
    expect(link.textContent).toContain("PI-0001");
    expect(link.textContent).toContain("Ідея про пасивний дохід");
  });

  test("до наведення тултіп не рендериться", () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  // status приходить із бази (idea-refs.server), а не з union-типу — на межі
  // рантайму це рядок поза словником IdeaStatus не виключений.
  test("статус поза словником IdeaStatus — тултіп не падає, показує сирий рядок як label", () => {
    mockRect();
    render(<IdeaRefPill idea={idea({ status: "archived" as IdeaStatus })} />);
    fireEvent.mouseEnter(wrapperOf());
    expect(screen.getByText("archived")).toBeDefined();
  });
});

describe("IdeaRefPill — показ і приховування тултіпа", () => {
  test("mouseEnter показує тултіп", () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    expect(screen.getByRole("tooltip")).toBeDefined();
  });

  test("mouseLeave планує закриття — після затримки тултіп зникає", async () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    fireEvent.mouseLeave(wrapperOf());
    // Реальні таймери: закриття йде через setTimeout(160мс) + вихідну анімацію
    // AnimatePresence, яка в jsdom теж рухається через реальний час.
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  test("mouseLeave одразу за mouseEnter скасовує заплановане закриття (timer.current truthy)", async () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    fireEvent.mouseLeave(wrapperOf());
    fireEvent.mouseEnter(wrapperOf());
    // Чекаємо довше за CLOSE_DELAY_MS — якби скасування не спрацювало, тултіп
    // би зник; ми перевіряємо, що він лишається.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(screen.getByRole("tooltip")).toBeDefined();
  });

  test("focus показує тултіп, blur ховає його після затримки", async () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.focus(wrapperOf());
    expect(screen.getByRole("tooltip")).toBeDefined();
    fireEvent.blur(wrapperOf());
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });
});

describe("IdeaRefPill — закриття по Escape/scroll/resize", () => {
  test("Escape закриває відкритий тултіп", async () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  test("інша клавіша тултіп не закриває", () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("tooltip")).toBeDefined();
  });

  test("scroll у capture-фазі закриває тултіп", async () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  test("resize вікна закриває тултіп", async () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    fireEvent.resize(window);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  test("закритий тултіп не реагує на подальші scroll/keydown (слухачі зняті useEffect-кліначем)", async () => {
    mockRect();
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    // Другий Escape/scroll не повинен впасти, навіть коли слухачів вже нема.
    expect(() => fireEvent.keyDown(window, { key: "Escape" })).not.toThrow();
    expect(() => fireEvent.scroll(window)).not.toThrow();
  });
});

describe("IdeaRefPill — позиціювання тултіпа (openUpward)", () => {
  test("below+200 не перевищує innerHeight — тултіп відкривається вниз", () => {
    mockRect({ top: 10, bottom: 30 });
    setViewport(1024, 768); // below=38, +200=238 <= 768 → умова OR-виразу false, друга не перевіряється
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    const tooltip = screen.getByRole("tooltip") as HTMLElement;
    expect(tooltip.style.top).not.toBe("");
    expect(tooltip.style.bottom).toBe("");
  });

  test("below+200 перевищує innerHeight, але rect.top <= 220 — все одно вниз", () => {
    mockRect({ top: 50, bottom: 700 });
    setViewport(1024, 768); // below=708, +200=908 > 768 true; rect.top=50 <= 220 → друга умова false
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    const tooltip = screen.getByRole("tooltip") as HTMLElement;
    expect(tooltip.style.bottom).toBe("");
    expect(tooltip.style.top).not.toBe("");
  });

  test("below+200 перевищує innerHeight і rect.top > 220 — тултіп відкривається вгору", () => {
    mockRect({ top: 500, bottom: 700 });
    setViewport(1024, 768); // below=708, +200=908 > 768 true; rect.top=500 > 220 true → обидві умови true
    render(<IdeaRefPill idea={idea()} />);
    fireEvent.mouseEnter(wrapperOf());
    const tooltip = screen.getByRole("tooltip") as HTMLElement;
    expect(tooltip.style.top).toBe("");
    expect(tooltip.style.bottom).not.toBe("");
  });
});

describe("IdeaRefPill — summary у тултіпі", () => {
  test("summary заданий — рендериться додатковий параграф з описом", () => {
    mockRect();
    render(<IdeaRefPill idea={idea({ summary: "Опис ідеї для тултіпа" })} />);
    fireEvent.mouseEnter(wrapperOf());
    expect(screen.getByText("Опис ідеї для тултіпа")).toBeDefined();
  });

  test("summary відсутній (null) — параграф з описом не рендериться", () => {
    mockRect();
    render(<IdeaRefPill idea={idea({ summary: null })} />);
    fireEvent.mouseEnter(wrapperOf());
    const tooltip = screen.getByRole("tooltip");
    // Лише заголовок лишається параграфом — другого <p> з описом немає.
    expect(tooltip.querySelectorAll("p")).toHaveLength(1);
  });

  test("довгий заголовок і summary з розміткоподібним текстом рендеряться без обрізання в DOM", () => {
    mockRect();
    const longTitle = "Дуже довга назва ідеї, яка описує механіку заробітку в деталях ".repeat(5).trim();
    const summaryWithMarkup = "Опис містить **не** справжній markdown, а лише зірочки й `код` як текст.";
    render(<IdeaRefPill idea={idea({ title: longTitle, summary: summaryWithMarkup })} />);
    fireEvent.mouseEnter(wrapperOf());
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText(longTitle)).toBeDefined();
    expect(within(tooltip).getByText(summaryWithMarkup)).toBeDefined();
  });
});
