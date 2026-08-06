import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import Prose from "./Prose";
import type { IdeaRef } from "@/lib/idea-refs";

function ref(overrides: Partial<IdeaRef> = {}): IdeaRef {
  return { id: "PI-0001", title: "Ідея про пасивний дохід", status: "new", summary: null, ...overrides };
}

describe("Prose — базовий markdown без ideaRefs", () => {
  test("рендерить markdown у прозу (заголовок, абзац, список)", () => {
    render(<Prose content={"# Заголовок\n\nАбзац тексту.\n\n- пункт 1\n- пункт 2"} />);
    expect(screen.getByRole("heading", { level: 1, name: "Заголовок" })).toBeDefined();
    expect(screen.getByText("Абзац тексту.")).toBeDefined();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("ideaRefs не передано — id ідеї в тексті лишається звичайним текстом, без посилання", () => {
    render(<Prose content="Дивись PI-0001 для деталей." />);
    expect(screen.getByText(/PI-0001/)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("ideaRefs — порожній об'єкт поводиться так само, як відсутній (Object.keys(...).length > 0 хибне)", () => {
    render(<Prose content="Дивись PI-0001 для деталей." ideaRefs={{}} />);
    expect(screen.getByText(/PI-0001/)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("Prose — заміна id ідеї на IdeaRefPill", () => {
  test("id, присутній у ideaRefs і згаданий у тексті — замінюється на посилання-пігулку", () => {
    render(
      <Prose
        content="Пов'язано з PI-0001."
        ideaRefs={{ "PI-0001": ref({ title: "Перша ідея" }) }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/ideas/PI-0001");
    expect(screen.getByText("Перша ідея")).toBeDefined();
  });

  test("id, згаданий у тексті, але відсутній у переданому ideaRefs — лишається текстом (рехейп його не знає)", () => {
    render(<Prose content="Дивись PI-9999 і PI-0001." ideaRefs={{ "PI-0001": ref() }} />);
    expect(screen.getByText(/PI-9999/)).toBeDefined();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  test("id усередині коду не замінюється (rehypeIdeaRefs пропускає code/pre)", () => {
    render(<Prose content={"`PI-0001` у бектіках"} ideaRefs={{ "PI-0001": ref() }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("PI-0001")).toBeDefined();
  });
});

describe("Prose — вміст із бази: крайні випадки", () => {
  test("порожній рядок — не падає, рендерить порожній контейнер", () => {
    const { container } = render(<Prose content="" />);
    expect(container.querySelector(".prose-doc")).toBeDefined();
    expect(container.querySelector(".prose-doc")?.textContent).toBe("");
  });

  test("null замість рядка (дані з бази без гарантії not-null) — фіксуємо фактичну поведінку", () => {
    // Тип content — string, але значення з БД може прийти null: перевіряємо,
    // що насправді відбувається, а не що мало б за типами.
    const attempt = () => render(<Prose content={null as unknown as string} />);
    let threw = false;
    try {
      attempt();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test("дуже довгий текст рендериться без падіння", () => {
    const long = "довгий абзац речення. ".repeat(2000);
    render(<Prose content={long} />);
    expect(screen.getByText(/довгий абзац речення\./)).toBeDefined();
  });

  test("сира HTML-розмітка всередині markdown не виконується і не рендериться як DOM-теги (react-markdown без rehype-raw)", () => {
    const { container } = render(
      <Prose content={'<script>window.__pwned = true;</script><b>жирний</b> текст'} />,
    );
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  test("зламаний markdown (незакрита кодова огорожа, розбита таблиця) не падає", () => {
    const broken = "```js\nconst x = 1;\n\n| a | b\n|---\n| 1 | 2 | 3 |\n\n**незакритий жирний";
    render(<Prose content={broken} />);
    expect(screen.getByText(/const x = 1;/)).toBeDefined();
  });
});
