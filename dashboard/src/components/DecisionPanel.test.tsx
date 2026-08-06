import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// decideIdea — серверна дія "use server", що тягне за собою "server-only",
// next/cache і живий Supabase-клієнт: у компонентному тесті її замінюємо
// повністю, інакше імпорт валиться ще на завантаженні модуля.
const { decideIdea, routerRefresh } = vi.hoisted(() => ({
  decideIdea: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("@/lib/actions/decisions", () => ({ decideIdea }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import DecisionPanel from "./DecisionPanel";

beforeEach(() => {
  decideIdea.mockReset();
  routerRefresh.mockReset();
});

describe("DecisionPanel — перше рішення (approved_pending)", () => {
  test("«Прийняти» без діалогу одразу викликає decideIdea з порожньою причиною", async () => {
    decideIdea.mockResolvedValue({});
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" />);

    fireEvent.click(screen.getByRole("button", { name: "Прийняти" }));

    await waitFor(() =>
      expect(decideIdea).toHaveBeenCalledWith({
        ideaId: "idea-1",
        action: "accepted",
        reason: "",
        rejectionCode: undefined,
      }),
    );
    await screen.findByText(/Рішення записано: прийняти/);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });

  test("«Відхилити» відкриває діалог, без коду й причини не відправляє", async () => {
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" />);

    fireEvent.click(screen.getByRole("button", { name: "Відхилити" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Відхилити" }));

    expect(decideIdea).not.toHaveBeenCalled();
    expect(
      screen.getByText("Для відхилення обов'язково вкажи причину і код відмови."),
    ).toBeDefined();
  });

  test("з кодом і причиною — відхилення відправляється і діалог закривається", async () => {
    decideIdea.mockResolvedValue({});
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" />);

    fireEvent.click(screen.getByRole("button", { name: "Відхилити" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Код відмови/), {
      target: { value: "LEGAL" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText(/Коротко поясни рішення/), {
      target: { value: "Заборонено в ЄС" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Відхилити" }));

    await waitFor(() =>
      expect(decideIdea).toHaveBeenCalledWith({
        ideaId: "idea-1",
        action: "rejected",
        reason: "Заборонено в ЄС",
        rejectionCode: "LEGAL",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("сервер повертає помилку на одноклікове «Прийняти» (без діалогу) — помилка з відступом mt-2, а не в діалозі", async () => {
    // start() для "accepted" без isRevision не відкриває діалог узагалі, тому
    // ця помилка рендериться в гілці error && !dialog поза DecisionDialog.
    decideIdea.mockResolvedValue({ error: "Немає з'єднання." });
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Прийняти" }));

    const error = await screen.findByText("Немає з'єднання.");
    expect(error.className).toContain("mt-2");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("сервер повертає помилку — діалог лишається відкритим із текстом помилки", async () => {
    decideIdea.mockResolvedValue({ error: "База недоступна." });
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" />);

    fireEvent.click(screen.getByRole("button", { name: "Відхилити" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Код відмови/), {
      target: { value: "LEGAL" },
    });
    fireEvent.change(within(dialog).getByPlaceholderText(/Коротко поясни рішення/), {
      target: { value: "Причина" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Відхилити" }));

    await screen.findByText("База недоступна.");
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});

describe("DecisionPanel — перегляд уже ухваленого рішення", () => {
  test("кнопка поточного статусу заблокована (крім «Відхилити»)", () => {
    render(<DecisionPanel ideaId="idea-2" currentStatus="accepted" />);
    const acceptBtn = screen.getByRole("button", { name: /Прийняти/ }) as HTMLButtonElement;
    expect(acceptBtn.disabled).toBe(true);
    const rejectBtn = screen.getByRole("button", { name: "Відхилити" }) as HTMLButtonElement;
    expect(rejectBtn.disabled).toBe(false);
  });

  test("зміна вже ухваленого рішення без причини — помилка, decideIdea не викликається", () => {
    render(<DecisionPanel ideaId="idea-2" currentStatus="rejected" />);
    // currentStatus !== approved_pending → навіть «Прийняти» відкриває діалог перегляду.
    fireEvent.click(screen.getByRole("button", { name: /Прийняти/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Прийняти" }));
    expect(decideIdea).not.toHaveBeenCalled();
    expect(screen.getByText("Зміна вже ухваленого рішення вимагає причини.")).toBeDefined();
  });

  test("зміна вже ухваленого рішення з причиною — відправляється як «accepted» без коду відмови", async () => {
    // rejectionCode лишається undefined саме для дії "accepted" — це та гілка
    // потрійного оператора в submit(), якої без цього тесту не торкались.
    decideIdea.mockResolvedValue({});
    render(<DecisionPanel ideaId="idea-2" currentStatus="rejected" />);
    fireEvent.click(screen.getByRole("button", { name: /Прийняти/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText(/Коротко поясни рішення/), {
      target: { value: "Передумали" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Прийняти" }));

    await waitFor(() =>
      expect(decideIdea).toHaveBeenCalledWith({
        ideaId: "idea-2",
        action: "accepted",
        reason: "Передумали",
        rejectionCode: undefined,
      }),
    );
  });

  test("перегляд рішення з відхиленням — діалог показує попередження про перезапис", () => {
    render(<DecisionPanel ideaId="idea-2" currentStatus="accepted" />);
    fireEvent.click(screen.getByRole("button", { name: "Відхилити" }));
    expect(
      screen.getByText("Ідея вже має рішення — цей запис перекриє попереднє."),
    ).toBeDefined();
  });
});

describe("DecisionPanel — bare/compact режими", () => {
  test("compact=true — менший padding (p-4 замість p-5)", () => {
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" compact />);
    const root = screen.getByRole("button", { name: "Прийняти" }).closest("div.rounded-lg");
    expect(root?.className).toContain("p-4");
    expect(root?.className).not.toContain("p-5");
  });

  test("bare=true — без рамки/підкладки, повідомлення про рішення без відступу mb-3", async () => {
    decideIdea.mockResolvedValue({});
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" bare />);
    fireEvent.click(screen.getByRole("button", { name: "Прийняти" }));

    const message = await screen.findByText(/Рішення записано: прийняти/);
    expect(message.className).not.toContain("mb-3");
  });

  test("bare=true — помилка одноклікового рішення (без діалогу) показується з text-right", async () => {
    decideIdea.mockResolvedValue({ error: "Немає з'єднання." });
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" bare />);
    fireEvent.click(screen.getByRole("button", { name: "Прийняти" }));

    const error = await screen.findByText("Немає з'єднання.");
    expect(error.className).toContain("text-right");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("DecisionPanel — діалог: клавіатура і клік по затемненню", () => {
  test("Escape закриває діалог", async () => {
    // Закриття йде через exit-анімацію AnimatePresence — вузол зникає з DOM
    // не синхронно з подією, тому потрібен waitFor (як і в сусідніх тестах).
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Відхилити" }));
    expect(screen.getByRole("dialog")).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("будь-яка інша клавіша діалог не закриває", () => {
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Відхилити" }));

    fireEvent.keyDown(document, { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  test("mousedown прямо по затемненню (не по картці) закриває діалог", async () => {
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Відхилити" }));
    const backdrop = screen.getByRole("dialog");

    fireEvent.mouseDown(backdrop);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("mousedown усередині картки діалог не закриває", () => {
    render(<DecisionPanel ideaId="idea-1" currentStatus="approved_pending" />);
    fireEvent.click(screen.getByRole("button", { name: "Відхилити" }));
    const dialog = screen.getByRole("dialog");

    fireEvent.mouseDown(within(dialog).getByRole("button", { name: "Скасувати" }));
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});
