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
});
