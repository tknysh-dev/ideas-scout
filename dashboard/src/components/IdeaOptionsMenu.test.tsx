import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// fetchDeepResearchPrompt — серверна дія, мокаємо весь модуль (як у
// ConsolidateReportsDialog.test.tsx / DecisionPanel.test.tsx).
const { fetchDeepResearchPrompt } = vi.hoisted(() => ({
  fetchDeepResearchPrompt: vi.fn(),
}));
vi.mock("@/lib/actions/deep-research", () => ({ fetchDeepResearchPrompt }));

// ConsolidateReportsDialog — окремий компонент зі своїми server actions і тестами
// (ConsolidateReportsDialog.test.tsx); тут важлива лише межа "меню відкриває
// діалог і повертає фокус при onClose", тож підміняємо його заглушкою.
const onCloseSpy = vi.fn();
vi.mock("@/components/ConsolidateReportsDialog", () => ({
  default: ({ ideaId, onClose }: { ideaId: string; onClose: () => void }) => {
    onCloseSpy.mockImplementation(onClose);
    return (
      <div data-testid="consolidate-dialog" data-idea-id={ideaId}>
        <button type="button" onClick={onClose}>
          закрити діалог-заглушку
        </button>
      </div>
    );
  },
}));

import IdeaOptionsMenu from "./IdeaOptionsMenu";

beforeEach(() => {
  fetchDeepResearchPrompt.mockReset();
  onCloseSpy.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  return writeText;
}

describe("IdeaOptionsMenu — відкриття меню", () => {
  test("за замовчуванням меню закрите — пункти не показані", () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: /Опції/ })).toBeDefined();
  });

  test("клік по «Опції» відкриває меню з обома пунктами", () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    const menu = screen.getByRole("menu");
    expect(menu).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Скопіювати промпт глибокого дослідження/ })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Консолідувати відповіді…/ })).toBeDefined();
  });

  test("повторний клік по «Опції» закриває меню (toggle)", async () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    const trigger = screen.getByRole("button", { name: "Опції" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeDefined();
    fireEvent.click(trigger);
    // AnimatePresence розмонтовує меню лише після exit-анімації — не синхронно.
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  test("ArrowDown на кнопці-тригері відкриває меню", () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Опції" }), { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeDefined();
  });

  test("Escape закриває меню і повертає фокус на тригер", async () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    const trigger = screen.getByRole("button", { name: "Опції" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  test("клік поза меню закриває його без повернення фокуса", async () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    const trigger = screen.getByRole("button", { name: "Опції" });
    fireEvent.click(trigger);
    trigger.blur();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).not.toBe(trigger);
  });

  test("клік усередині меню не закриває його", () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeDefined();
  });
});

describe("IdeaOptionsMenu — навігація клавіатурою в меню", () => {
  test("ArrowDown/ArrowUp циклічно переміщує фокус між пунктами", () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(items[1], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[1]);
  });

  test("Tab у пункті меню закриває меню без повернення фокуса", async () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    const trigger = screen.getByRole("button", { name: "Опції" });
    fireEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(items[0], { key: "Tab" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).not.toBe(trigger);
  });
});

describe("IdeaOptionsMenu — «Скопіювати промпт»", () => {
  test("успіх — копіює в буфер і показує довжину промпта", async () => {
    const writeText = stubClipboard();
    fetchDeepResearchPrompt.mockResolvedValue({ prompt: "abcde" });
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Скопіювати промпт/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("abcde"));
    await screen.findByText(/Промпт скопійовано — 5 символів/);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  test("клік по пункту одразу закриває меню (до відповіді сервера)", async () => {
    stubClipboard();
    // Проміс контрольовано резолвиться в кінці тесту — незавершена транзиція,
    // що лишилась некрою після cleanup(), спостережувано зачіпає isPending
    // сусіднього тесту через спільний React-планувальник у jsdom.
    let resolve: (value: unknown) => void = () => {};
    fetchDeepResearchPrompt.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Скопіювати промпт/ }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    await act(async () => {
      resolve!({ prompt: "abc" });
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  test("під час запиту тригер показує «Готуємо промпт…» і вимкнений", async () => {
    stubClipboard();
    let resolve: (value: unknown) => void = () => {};
    fetchDeepResearchPrompt.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Скопіювати промпт/ }));

    const trigger = await screen.findByRole("button", { name: "Готуємо промпт…" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);

    // React-транзиція асинхронна (React 19 async actions): без явного flush в
    // act() pending лишається true в тестовому середовищі, хоч фідбек уже готовий.
    await act(async () => {
      resolve!({ prompt: "abc" });
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Опції" })).toBeDefined());
  });

  test("сервер повертає error — фідбек з текстом помилки", async () => {
    stubClipboard();
    fetchDeepResearchPrompt.mockResolvedValue({ error: "Промпт не збудувався." });
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Скопіювати промпт/ }));

    await screen.findByText("Промпт не збудувався.");
  });

  test("сервер повертає порожній результат без error — типове повідомлення", async () => {
    stubClipboard();
    fetchDeepResearchPrompt.mockResolvedValue({});
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Скопіювати промпт/ }));

    await screen.findByText("Промпт не сформувався.");
  });

  test("clipboard.writeText кидає виняток — повідомлення про буфер обміну", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    fetchDeepResearchPrompt.mockResolvedValue({ prompt: "abc" });
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Скопіювати промпт/ }));

    await screen.findByText(/Браузер не дав записати текст у буфер обміну/);
  });

  test("fetchDeepResearchPrompt кидає виняток — те саме повідомлення про буфер (спільний catch)", async () => {
    stubClipboard();
    fetchDeepResearchPrompt.mockRejectedValue(new Error("network"));
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Скопіювати промпт/ }));

    await screen.findByText(/Браузер не дав записати текст у буфер обміну/);
  });
});

describe("IdeaOptionsMenu — «Консолідувати відповіді…»", () => {
  test("клік по пункту закриває меню і відкриває діалог з тим самим ideaId", async () => {
    render(<IdeaOptionsMenu ideaId="idea-42" />);
    fireEvent.click(screen.getByRole("button", { name: "Опції" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Консолідувати відповіді…/ }));

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    const dialog = screen.getByTestId("consolidate-dialog");
    expect(dialog.getAttribute("data-idea-id")).toBe("idea-42");
  });

  test("onClose діалогу закриває його і повертає фокус на тригер", () => {
    render(<IdeaOptionsMenu ideaId="idea-1" />);
    const trigger = screen.getByRole("button", { name: "Опції" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Консолідувати відповіді…/ }));

    // Заглушка діалогу рендериться без AnimatePresence, тож onClose тут прибирає її синхронно.
    fireEvent.click(screen.getByText("закрити діалог-заглушку"));
    expect(screen.queryByTestId("consolidate-dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
