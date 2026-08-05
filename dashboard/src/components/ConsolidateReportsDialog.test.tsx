import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// commitDeepResearchReports/previewDeepResearchReports/fetchKnownResearcherModels —
// серверні дії з "use server" (тягнуть Supabase, next/cache); у компонентному
// тесті підміняємо весь модуль, як і в DecisionPanel.test.tsx.
const { previewDeepResearchReports, commitDeepResearchReports, fetchKnownResearcherModels, routerRefresh } =
  vi.hoisted(() => ({
    previewDeepResearchReports: vi.fn(),
    commitDeepResearchReports: vi.fn(),
    fetchKnownResearcherModels: vi.fn(),
    routerRefresh: vi.fn(),
  }));

vi.mock("@/lib/actions/deep-research", () => ({
  previewDeepResearchReports,
  commitDeepResearchReports,
  fetchKnownResearcherModels,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

import ConsolidateReportsDialog from "./ConsolidateReportsDialog";

beforeEach(() => {
  previewDeepResearchReports.mockReset();
  commitDeepResearchReports.mockReset();
  fetchKnownResearcherModels.mockReset().mockResolvedValue({});
  routerRefresh.mockReset();
});

// getByLabelText не враховує `hidden` на прихованих вкладках (їх у DOM одразу
// декілька) — getByRole сам фільтрує невидиме, тому беремо textbox через нього.
function typeText(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: /Відповідь моделі/ }), { target: { value: text } });
}

describe("ConsolidateReportsDialog — відкриття і закриття", () => {
  test("рендерить діалог з першою вкладкою ChatGPT і порожнім полем", () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Консолідація відповідей моделей" })).toBeDefined();
    expect(screen.getByRole("button", { name: "ChatGPT" })).toBeDefined();
    expect(screen.getByLabelText(/Відповідь моделі/)).toBeDefined();
  });

  test("«Скасувати» викликає onClose", () => {
    const onClose = vi.fn();
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Скасувати" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("клік по затемненню (сам overlay) закриває діалог", () => {
    const onClose = vi.fn();
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={onClose} />);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("клік усередині картки діалогу не закриває його", () => {
    const onClose = vi.fn();
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={onClose} />);
    fireEvent.mouseDown(screen.getByLabelText(/Відповідь моделі/));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Escape закриває діалог", () => {
    const onClose = vi.fn();
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ConsolidateReportsDialog — вкладки і провайдер", () => {
  test("«+ ще одна» додає вкладку з першим вільним провайдером", () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "+ ще одна" }));
    expect(screen.getByRole("button", { name: "Claude" })).toBeDefined();
  });

  test("вибір «Інший…» показує поле назви сервісу, і в нього можна ввести назву", () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Провайдер"), { target: { value: "Інший…" } });
    const customField = screen.getByPlaceholderText("як він зветься") as HTMLInputElement;
    fireEvent.change(customField, { target: { value: "Mistral Le Chat Pro" } });
    expect(customField.value).toBe("Mistral Le Chat Pro");
  });

  test("поле моделі приймає ввід і показує підказки з довідника fetchKnownResearcherModels", async () => {
    fetchKnownResearcherModels.mockResolvedValue({ ChatGPT: ["gpt-5", "gpt-5-thinking"] });
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    await waitFor(() => expect(fetchKnownResearcherModels).toHaveBeenCalled());

    const modelField = screen.getByLabelText(/^Модель/) as HTMLInputElement;
    fireEvent.change(modelField, { target: { value: "gpt-5" } });
    expect(modelField.value).toBe("gpt-5");
    // <option value=".."/> без дочірнього тексту — getByText його не бачить,
    // тож підказку довідника перевіряємо через атрибут value.
    await waitFor(() =>
      expect(document.querySelector('option[value="gpt-5-thinking"]')).not.toBeNull(),
    );
  });

  test("«прибрати» доступне лише коли вкладок більше однієї", () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "прибрати" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ ще одна" }));
    expect(screen.getByRole("button", { name: "прибрати" })).toBeDefined();
  });

  test("«прибрати» видаляє вкладку і повертає активну на попередню", () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "+ ще одна" }));
    fireEvent.click(screen.getByRole("button", { name: "прибрати" }));
    expect(screen.queryByRole("button", { name: "Claude" })).toBeNull();
    expect(screen.getByRole("button", { name: "ChatGPT" })).toBeDefined();
  });

  test("клік по вкладці перемикає видиме поле тексту", () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    // "+ ще одна" одразу перемикає активну вкладку на щойно додану (Claude).
    fireEvent.click(screen.getByRole("button", { name: "+ ще одна" }));
    typeText("текст Claude");

    fireEvent.click(screen.getByRole("button", { name: "ChatGPT" }));
    const chatgptField = screen.getByRole("textbox", { name: /Відповідь моделі/ }) as HTMLTextAreaElement;
    expect(chatgptField.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Claude" }));
    const claudeField = screen.getByRole("textbox", { name: /Відповідь моделі/ }) as HTMLTextAreaElement;
    expect(claudeField.value).toBe("текст Claude");
  });
});

describe("ConsolidateReportsDialog — валідація і розбір", () => {
  test("«Розібрати текст» вимкнена, поки всі поля порожні", () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Розібрати текст" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  test("з непорожнім текстом кнопка розбору активна", () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    typeText("щось є");
    const btn = screen.getByRole("button", { name: "Розібрати текст" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  test("під час розбору кнопка показує «Розбираємо…» і вимкнена", async () => {
    let resolve: (value: unknown) => void = () => {};
    previewDeepResearchReports.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    typeText("щось є");
    fireEvent.click(screen.getByRole("button", { name: "Розібрати текст" }));

    await screen.findByRole("button", { name: "Розбираємо…" });
    const btn = screen.getByRole("button", { name: "Розбираємо…" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    resolve!({ reports: [], validCount: 0 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Розібрати текст" })).toBeDefined());
  });

  test("сервер повертає помилку розбору — показується текст, звітів немає", async () => {
    previewDeepResearchReports.mockResolvedValue({ error: "Не вдалося розпізнати текст." });
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    typeText("щось є");
    fireEvent.click(screen.getByRole("button", { name: "Розібрати текст" }));

    await screen.findByText("Не вдалося розпізнати текст.");
    expect(screen.queryByText(/Розпізнано/)).toBeNull();
  });

  test("виняток мережі під час розбору — узагальнене повідомлення", async () => {
    previewDeepResearchReports.mockRejectedValue(new Error("network down"));
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    typeText("щось є");
    fireEvent.click(screen.getByRole("button", { name: "Розібрати текст" }));

    await screen.findByText("Не вдалося зв'язатися з сервером. Онови сторінку і спробуй ще раз.");
  });

  test("успішний розбір показує список звітів і лічильник придатних", async () => {
    previewDeepResearchReports.mockResolvedValue({
      reports: [
        {
          provider: "ChatGPT",
          status: "ok",
          model: "gpt-5",
          criteriaCount: 3,
          competitorsCount: 2,
          notes: [],
        },
      ],
      validCount: 1,
    });
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    typeText("щось є");
    fireEvent.click(screen.getByRole("button", { name: "Розібрати текст" }));

    await screen.findByText(/Розпізнано 1 звіт, придатних до консолідації — 1/);
    expect(screen.getByText("gpt-5")).toBeDefined();
    expect(screen.getByText("Готово")).toBeDefined();
  });

  test("рядок звіту показує problem і кожну нотатку (refused зі службовими текстами)", async () => {
    previewDeepResearchReports.mockResolvedValue({
      reports: [
        {
          provider: "Perplexity",
          status: "refused",
          model: null,
          criteriaCount: 0,
          competitorsCount: 0,
          problem: "Модель відмовилась шукати в інтернеті",
          notes: ["Перша нотатка", "Друга нотатка"],
        },
      ],
      validCount: 0,
    });
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    typeText("щось є");
    fireEvent.click(screen.getByRole("button", { name: "Розібрати текст" }));

    await screen.findByText("Без пошуку");
    expect(screen.getByText("Модель відмовилась шукати в інтернеті")).toBeDefined();
    expect(screen.getByText("Перша нотатка")).toBeDefined();
    expect(screen.getByText("Друга нотатка")).toBeDefined();
  });

  test("0 придатних звітів — попередження про те, що в базу нічого не записано", async () => {
    previewDeepResearchReports.mockResolvedValue({
      reports: [{ provider: "ChatGPT", status: "empty", model: null, criteriaCount: 0, competitorsCount: 0, notes: [] }],
      validCount: 0,
    });
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    typeText("щось є");
    fireEvent.click(screen.getByRole("button", { name: "Розібрати текст" }));

    await screen.findByText(/Поки жоден звіт не годиться для зведення/);
  });

  test("редагування тексту після розбору скидає раніше показані звіти й помилку", async () => {
    previewDeepResearchReports.mockResolvedValue({
      reports: [{ provider: "ChatGPT", status: "ok", model: null, criteriaCount: 1, competitorsCount: 1, notes: [] }],
      validCount: 1,
    });
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    typeText("щось є");
    fireEvent.click(screen.getByRole("button", { name: "Розібрати текст" }));
    await screen.findByText(/Розпізнано/);

    typeText("щось є, змінено");
    expect(screen.queryByText(/Розпізнано/)).toBeNull();
  });
});

describe("ConsolidateReportsDialog — консолідація", () => {
  async function previewOk() {
    previewDeepResearchReports.mockResolvedValue({
      reports: [{ provider: "ChatGPT", status: "ok", model: null, criteriaCount: 1, competitorsCount: 1, notes: [] }],
      validCount: 1,
    });
    typeText("щось є");
    fireEvent.click(screen.getByRole("button", { name: "Розібрати текст" }));
    await screen.findByText(/Розпізнано/);
  }

  test("«Запустити консолідацію» вимкнена, поки звіти не розібрані", () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "Запустити консолідацію" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  test("«Запустити консолідацію» вимкнена, коли придатних звітів 0", async () => {
    previewDeepResearchReports.mockResolvedValue({ reports: [], validCount: 0 });
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    typeText("щось є");
    fireEvent.click(screen.getByRole("button", { name: "Розібрати текст" }));
    await screen.findByText(/Поки жоден звіт не годиться для зведення/);
    // "Розпізнано…" з'являється в тому ж рендері, що й лічильник, але pending
    // (транзиція) осідає на тік пізніше — чекаємо, поки кнопка розбору
    // повернеться в стан спокою, інакше перевірка commit-кнопки може зловити
    // проміжний рендер.
    await waitFor(() => expect(screen.getByRole("button", { name: "Розібрати текст" })).toBeDefined());
    const btn = screen.getByRole("button", { name: "Запустити консолідацію" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  test("сервер повертає помилку під час запису — текст помилки, done не встановлюється", async () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    await previewOk();
    commitDeepResearchReports.mockResolvedValue({ error: "База недоступна." });
    fireEvent.click(screen.getByRole("button", { name: "Запустити консолідацію" }));

    await screen.findByText("База недоступна.");
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  test("виняток мережі під час запису — узагальнене повідомлення", async () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    await previewOk();
    commitDeepResearchReports.mockRejectedValue(new Error("boom"));
    fireEvent.click(screen.getByRole("button", { name: "Запустити консолідацію" }));

    await screen.findByText("Не вдалося зв'язатися з сервером. Онови сторінку і спробуй ще раз.");
  });

  test("успішний запис показує підсумок, кличе router.refresh і ставить синтез у чергу", async () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    await previewOk();
    commitDeepResearchReports.mockResolvedValue({
      savedCount: 1,
      verdictCount: 3,
      alreadyQueued: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Запустити консолідацію" }));

    await screen.findByText(/Збережено 1 звіт і 3 вердикти\. Синтез поставлено в чергу M1\./);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Закрити" })).toBeDefined();
  });

  test("alreadyQueued=true — повідомлення, що синтез уже стояв у черзі", async () => {
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    await previewOk();
    commitDeepResearchReports.mockResolvedValue({
      savedCount: 1,
      verdictCount: 1,
      alreadyQueued: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Запустити консолідацію" }));

    await screen.findByText(/Синтез уже стояв у черзі — другий раз не додаємо\./);
  });

  test("«Закрити» після успіху кличе onClose", async () => {
    const onClose = vi.fn();
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={onClose} />);
    await previewOk();
    commitDeepResearchReports.mockResolvedValue({ savedCount: 1, verdictCount: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Запустити консолідацію" }));
    await screen.findByRole("button", { name: "Закрити" });

    fireEvent.click(screen.getByRole("button", { name: "Закрити" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ConsolidateReportsDialog — довідник моделей", () => {
  test("fetchKnownResearcherModels, що падає з помилкою, не ламає рендер", async () => {
    fetchKnownResearcherModels.mockReset().mockRejectedValue(new Error("fail"));
    render(<ConsolidateReportsDialog ideaId="idea-1" onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});
