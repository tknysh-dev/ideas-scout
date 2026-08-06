// Card тягне idea-refs.server.ts -> "server-only" і живий Supabase-клієнт:
// у компонентному тесті обидва мокаємо повністю (як idea-refs-server.test.tsx),
// інакше імпорт валиться ще на завантаженні модуля. Card — асинхронний
// серверний компонент: клієнтський react-dom (яким рендерить RTL) не вміє
// його змонтувати через JSX (падає з "Only Server Components can be async"),
// тож викликаємо його напряму як функцію й рендеримо вже готовий елемент.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const { getServiceClient } = vi.hoisted(() => ({ getServiceClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ getServiceClient }));

import Card from "@/components/Card";

function supabaseWith(data: unknown) {
  const select = vi.fn(async () => ({ data }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, select, from };
}

const REGISTRY_ROWS = [
  { id: "PI-0001", title: "Перша ідея", status: "new", mechanic_summary: "коротко" },
];

beforeEach(() => {
  getServiceClient.mockReset();
  getServiceClient.mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Card — plain режим", () => {
  test("plain=true — без рамки й підкладки (лише переданий className)", async () => {
    const el = await Card({ plain: true, className: "extra-class", children: <p>вміст</p> });
    const { container } = render(el);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("border");
    expect(root.className).not.toContain("rounded-lg");
    expect(root.className).toContain("extra-class");
  });

  test("plain=false (дефолт) — картка отримує рамку й підкладку", async () => {
    const el = await Card({ children: <p>вміст</p> });
    const { container } = render(el);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("rounded-lg");
    expect(root.className).toContain("border-line");
  });
});

describe("Card — accent", () => {
  test("accent=true (і plain=false) — подвійна рамка border-2 border-accent замість звичайної", async () => {
    const el = await Card({ accent: true, children: <p>вміст</p> });
    const { container } = render(el);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("border-2");
    expect(root.className).toContain("border-accent");
  });

  test("accent=false (дефолт) — звичайна рамка border-line, без border-2", async () => {
    const el = await Card({ children: <p>вміст</p> });
    const { container } = render(el);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("border-2");
    expect(root.className).toContain("border-line");
  });
});

describe("Card — тег as", () => {
  test("as='li' (не дефолтний div) — картка рендериться тегом li", async () => {
    const el = await Card({ as: "li", children: <p>вміст</p> });
    const { container } = render(el);
    expect(container.firstElementChild?.tagName).toBe("LI");
  });

  test("as не переданий (дефолт 'div') — картка рендериться тегом div", async () => {
    const el = await Card({ children: <p>вміст</p> });
    const { container } = render(el);
    expect(container.firstElementChild?.tagName).toBe("DIV");
  });
});

describe("Card — рефи ідей: Object.keys(refs).length > 0", () => {
  test("текст без id ідей і без бази — refs порожній, children повертаються без змін", async () => {
    const el = await Card({ children: <p>звичайний текст без згадувань</p> });
    render(el);
    expect(screen.getByText("звичайний текст без згадувань")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("текст згадує id, база не сконфігурована (getServiceClient() === null) — refs порожній, лишається текстом", async () => {
    const el = await Card({ children: <p>Дивись PI-0001 для деталей.</p> });
    render(el);
    expect(screen.getByText(/PI-0001/)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("текст згадує id, реєстр повертає збіг — id замінюється на IdeaRefPill (посилання)", async () => {
    const { client } = supabaseWith(REGISTRY_ROWS);
    getServiceClient.mockReturnValue(client);
    const el = await Card({ children: <p>Дивись PI-0001 для деталей.</p> });
    render(el);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/ideas/PI-0001");
    expect(screen.getByText("Перша ідея")).toBeDefined();
  });

  test("exclude вилучає самопосилання навіть коли реєстр має збіг — картка не лінкує саму себе", async () => {
    const { client } = supabaseWith(REGISTRY_ROWS);
    getServiceClient.mockReturnValue(client);
    const el = await Card({ exclude: "PI-0001", children: <p>Схоже на PI-0001.</p> });
    render(el);
    expect(screen.getByText(/PI-0001/)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("exclude не переданий (дефолт undefined) — id з реєстру лінкується як завжди", async () => {
    const { client } = supabaseWith(REGISTRY_ROWS);
    getServiceClient.mockReturnValue(client);
    const el = await Card({ children: <p>PI-0001 без exclude.</p> });
    render(el);
    expect(screen.getByRole("link")).toBeDefined();
  });
});

describe("Card — padding", () => {
  test("padding='none' (не дефолт 'md') — без padding-класів у shell", async () => {
    const el = await Card({ padding: "none", children: <p>вміст</p> });
    const { container } = render(el);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain("p-4");
    expect(root.className).not.toContain("p-5");
    expect(root.className).not.toContain("p-6");
  });

  test("padding не переданий (дефолт 'md') — p-5", async () => {
    const el = await Card({ children: <p>вміст</p> });
    const { container } = render(el);
    expect((container.firstElementChild as HTMLElement).className).toContain("p-5");
  });
});
