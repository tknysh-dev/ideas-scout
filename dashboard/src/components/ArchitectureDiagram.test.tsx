import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// mermaid тягне за собою canvas/layout, якого jsdom не реалізує — реальний
// рендер діаграми або пропускаємо, або мокаємо. Мокаємо: initialize/render
// підмінені заглушкою, що повертає фіксовану SVG-розмітку з вузлами, чиї id
// відтворюють формат Mermaid (`<svg-id>-flowchart-<ключ>-<n>`). Це дає змогу
// накрити саме nodeKeyOf() — приватну функцію розбору id, яку не можна
// заімпортувати напряму, — через реальну поведінку кліків по вузлах.
const FAKE_SVG = `
<svg viewBox="0 0 300 150" xmlns="http://www.w3.org/2000/svg">
  <g class="node" id="arch-svg-x-flowchart-owner-1"><rect /></g>
  <g class="node" id="arch-svg-x-flowchart-collector__cfg-5"><rect /></g>
  <g class="node" id="arch-svg-x-flowchart-telegram-3"><rect /></g>
  <g class="node" id="arch-svg-x-flowchart-nosuchkey-7"><rect /></g>
  <g class="node" id="not-matching-pattern-at-all"><rect /></g>
  <g class="not-a-node" id="arch-svg-x-flowchart-owner-9"><rect /></g>
</svg>`;

const mermaidRender = vi.fn().mockResolvedValue({ svg: FAKE_SVG });
const mermaidInitialize = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => mermaidInitialize(...args),
    render: (...args: unknown[]) => mermaidRender(...args),
  },
}));

const { loadArchDoc } = vi.hoisted(() => ({ loadArchDoc: vi.fn() }));
vi.mock("@/lib/actions/architecture", () => ({ loadArchDoc }));

import ArchitectureDiagram from "./ArchitectureDiagram";

// Ловимо всі підписки draw() на "matchMedia change" в один спільний реєстр:
// повторний vi.stubGlobal("matchMedia", ...) всередині окремого тесту (поверх
// того, що вже виставив beforeEach) емпірично ламає мокання динамічного
// import("mermaid") для другої діаграми — та встигає піти в реальний mermaid
// і впасти на кольорах теми. Тож стабуємо matchMedia рівно один раз тут.
let mediaChangeHandlers: Array<() => void> = [];

beforeEach(() => {
  mermaidRender.mockClear().mockResolvedValue({ svg: FAKE_SVG });
  mermaidInitialize.mockClear();
  loadArchDoc.mockReset().mockResolvedValue({ content: null, changed: null, error: null });
  mediaChangeHandlers = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_event: string, handler: () => void) => {
        mediaChangeHandlers.push(handler);
      },
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderReady() {
  render(<ArchitectureDiagram />);
  await waitFor(() => expect(mermaidRender).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelectorAll("svg").length).toBeGreaterThan(0));
}

describe("ArchitectureDiagram — розбір id вузла (nodeKeyOf) через клік", () => {
  test("вузол з id, що відповідає відомому ключу, відкриває попап цього вузла", async () => {
    await renderReady();
    const node = document.getElementById("arch-svg-x-flowchart-owner-1")!;
    fireEvent.click(node);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Власник");
  });

  test("суфікс __cfg відрізається — той самий ключ, що й без суфікса", async () => {
    await renderReady();
    const node = document.getElementById("arch-svg-x-flowchart-collector__cfg-5")!;
    fireEvent.click(node);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Агент-збирач");
  });

  test("ключ, якого немає в ARCH_NODES, — клік нічого не відкриває", async () => {
    await renderReady();
    const node = document.getElementById("arch-svg-x-flowchart-nosuchkey-7")!;
    fireEvent.click(node);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("id, що взагалі не матчить патерн flowchart-*-N, — клік безпечний і нічого не відкриває", async () => {
    await renderReady();
    const node = document.getElementById("not-matching-pattern-at-all")!;
    fireEvent.click(node);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("клік по дочірньому <rect> усередині вузла теж відкриває попап (closest підіймається до g.node)", async () => {
    await renderReady();
    const rectInsideNode = document.querySelector("#arch-svg-x-flowchart-owner-1 rect")!;
    fireEvent.click(rectInsideNode);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Власник");
  });

  test("клавіша Enter на вузлі з фокусом теж відкриває попап", async () => {
    await renderReady();
    const node = document.getElementById("arch-svg-x-flowchart-owner-1")!;
    fireEvent.keyDown(node, { key: "Enter" });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Власник");
  });

  test("вузли з валідним ключем отримують role=button і tabindex, невалідні — ні", async () => {
    await renderReady();
    const validNode = document.getElementById("arch-svg-x-flowchart-owner-1")!;
    const invalidNode = document.getElementById("arch-svg-x-flowchart-nosuchkey-7")!;
    expect(validNode.getAttribute("role")).toBe("button");
    expect(validNode.getAttribute("tabindex")).toBe("0");
    expect(invalidNode.getAttribute("role")).toBeNull();
    expect(invalidNode.getAttribute("tabindex")).toBeNull();
  });

  test("зміна теми (matchMedia change) перемальовує діаграму вдруге", async () => {
    await renderReady();
    // Дві діаграми ARCH_DIAGRAMS — кожна підписалась на зміну теми окремо.
    await waitFor(() => expect(mediaChangeHandlers).toHaveLength(2));
    const callsBefore = mermaidRender.mock.calls.length;

    mediaChangeHandlers[0]();
    await waitFor(() => expect(mermaidRender.mock.calls.length).toBeGreaterThan(callsBefore));
  });
});

describe("ArchitectureDiagram — попап вузла", () => {
  test("Escape закриває попап", async () => {
    await renderReady();
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-owner-1")!);
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("клік по кнопці «Закрити» закриває попап", async () => {
    await renderReady();
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-owner-1")!);
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Закрити" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("клік по затемненню закриває попап, клік усередині картки — ні", async () => {
    await renderReady();
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-owner-1")!);
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(screen.getByText("Власник"));
    expect(screen.getByRole("dialog")).toBeDefined();

    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("вузол без doc і без ref — попап без блоку файлу і без футера", async () => {
    await renderReady();
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-owner-1")!);
    await screen.findByRole("dialog");

    expect(screen.queryByText("Читаю файл…")).toBeNull();
    expect(screen.queryByRole("link", { name: /Відкрити окремою сторінкою/ })).toBeNull();
    expect(loadArchDoc).toHaveBeenCalledWith("owner");
  });

  test("вузол лише з ref (без doc) — заголовок показує ref, блоку файлу й футера немає", async () => {
    await renderReady();
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-telegram-3")!);
    const dialog = await screen.findByRole("dialog");

    expect(dialog.getAttribute("aria-label")).toBe("Telegram-бот");
    expect(screen.getByText(/agents\/scripts\/telegram-bot\.py/)).toBeDefined();
    expect(screen.queryByText("Читаю файл…")).toBeNull();
    expect(screen.queryByRole("link", { name: /Відкрити окремою сторінкою/ })).toBeNull();
  });

  test("вузол з doc — поки loadArchDoc не відповів, показує «Читаю файл…»", async () => {
    let resolve: (value: unknown) => void = () => {};
    loadArchDoc.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await renderReady();
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-collector__cfg-5")!);
    await screen.findByRole("dialog");

    expect(screen.getByText("Читаю файл…")).toBeDefined();
    resolve!({ content: "# Збирач", changed: null, error: null });
    await waitFor(() => expect(screen.queryByText("Читаю файл…")).toBeNull());
  });

  test("вузол з doc — успішний вміст .md рендериться і показує посилання «Відкрити окремою сторінкою»", async () => {
    loadArchDoc.mockResolvedValue({ content: "# Агент-збирач", changed: "2026-01-01T00:00:00.000Z", error: null });
    await renderReady();
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-collector__cfg-5")!);
    await screen.findByRole("dialog");

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Відкрити окремою сторінкою/ }).getAttribute("href")).toBe(
        "/config/agents/prompts/collector.md",
      ),
    );
  });

  test("вузол з doc — помилка читання файлу показується текстом", async () => {
    loadArchDoc.mockResolvedValue({ content: null, changed: null, error: "файл не знайдено" });
    await renderReady();
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-collector__cfg-5")!);
    await screen.findByRole("dialog");

    await screen.findByText(/Не вдалося прочитати agents\/prompts\/collector\.md: файл не знайдено/);
  });
});

describe("ArchitectureDiagram — помилка рендеру mermaid", () => {
  test("mermaid.render, що падає, показує повідомлення про помилку замість діаграми", async () => {
    mermaidRender.mockRejectedValue(new Error("не вдалося намалювати"));
    render(<ArchitectureDiagram />);

    await screen.findByText(/Не вдалося намалювати діаграму: не вдалося намалювати/);
  });

  test("mermaid.render падає не з Error, а з рядком — показує «Невідома помилка»", async () => {
    // catch(err) не гарантує Error: throw string — валідний JS, і код це явно
    // обробляє (err instanceof Error ? ... : "Невідома помилка").
    mermaidRender.mockRejectedValue("щось пішло не так");
    render(<ArchitectureDiagram />);

    await screen.findByText(/Не вдалося намалювати діаграму: Невідома помилка/);
  });
});

describe("ArchitectureDiagram — mermaid повертає розмітку без <svg>", () => {
  test("розмітка без кореневого svg — без падіння і без помилки, просто нічого стилізувати", async () => {
    // container.querySelector("svg") поверне null: перевіряємо, що код не
    // намагається виставити style на null-елемент і не падає в catch.
    // Дивимось лише на першу діаграму — mockResolvedValueOnce стосується
    // рівно одного виклику, а другий iде за замовчуванням (FAKE_SVG);
    // глобальні твердження про обидві діаграми зайві для цієї гілки.
    mermaidRender.mockResolvedValueOnce({ svg: "<div>раптом не svg</div>" });
    render(<ArchitectureDiagram />);

    const firstContainer = document.querySelectorAll(".overflow-x-auto")[0] as HTMLElement;
    await waitFor(() => expect(firstContainer.textContent).toContain("раптом не svg"));
    expect(firstContainer.querySelector("svg")).toBeNull();
  });
});

describe("ArchitectureDiagram — клік по вузлу без предка g.node", () => {
  test("клік по елементу поза будь-яким g.node — безпечний, попап не відкривається", async () => {
    await renderReady();
    // g.node з іншим класом у фікстурі FAKE_SVG — closest("g.node") на ньому не знайде нічого.
    const node = document.getElementById("arch-svg-x-flowchart-owner-9")!;
    fireEvent.click(node);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ArchitectureDiagram — клавіші на вузлі, відмінні від Enter/Space", () => {
  test("Tab на вузлі попап не відкриває", async () => {
    await renderReady();
    const node = document.getElementById("arch-svg-x-flowchart-owner-1")!;
    fireEvent.keyDown(node, { key: "Tab" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("пробіл на вузлі теж відкриває попап (не лише Enter)", async () => {
    await renderReady();
    const node = document.getElementById("arch-svg-x-flowchart-owner-1")!;
    fireEvent.keyDown(node, { key: " " });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Власник");
  });
});

describe("ArchitectureDiagram — попап: клавіша, відмінна від Escape", () => {
  test("будь-яка інша клавіша попап не закриває", async () => {
    await renderReady();
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-owner-1")!);
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeDefined();
  });
});

describe("ArchitectureDiagram — застарілий запит doc після закриття/перевідкриття", () => {
  test("loadArchDoc, що відповідає вже після закриття й повторного відкриття, не перезаписує актуальний вміст", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    loadArchDoc.mockReturnValueOnce(
      new Promise((r) => {
        resolveFirst = r;
      }),
    );
    await renderReady();

    fireEvent.click(document.getElementById("arch-svg-x-flowchart-collector__cfg-5")!);
    await screen.findByRole("dialog");
    expect(screen.getByText("Читаю файл…")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Закрити" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    loadArchDoc.mockResolvedValueOnce({ content: "# Свіжий вміст", changed: null, error: null });
    fireEvent.click(document.getElementById("arch-svg-x-flowchart-collector__cfg-5")!);
    await screen.findByRole("dialog");
    await screen.findByText("Свіжий вміст");

    resolveFirst({ content: "# Застарілий вміст", changed: null, error: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Застарілий вміст")).toBeNull();
    expect(screen.getByText("Свіжий вміст")).toBeDefined();
  });
});
