import { describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CollapsibleBody from "./CollapsibleBody";

// jsdom не рахує layout — scrollHeight завжди 0. Підміняємо гетер на прототипі,
// щоб симулювати "вміст переповнює клітинку" без реального рендеру шрифтів.
let mockScrollHeight = 0;
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get() {
    return mockScrollHeight;
  },
});

describe("CollapsibleBody", () => {
  test("вміст, що вміщується — без кнопки «Показати повністю»", () => {
    mockScrollHeight = 40;
    render(
      <CollapsibleBody>
        <p>Короткий текст</p>
      </CollapsibleBody>,
    );
    expect(screen.queryByText("Показати повністю")).toBeNull();
  });

  test("вміст, що переповнює — кнопка з'являється, клік розгортає й підписує «Згорнути»", () => {
    mockScrollHeight = 300;
    render(
      <CollapsibleBody>
        <p>Дуже довгий текст на кілька абзаців</p>
      </CollapsibleBody>,
    );

    const toggle = screen.getByText("Показати повністю");
    fireEvent.click(toggle);
    expect(screen.getByText("Згорнути")).toBeDefined();
    expect(screen.queryByText("Показати повністю")).toBeNull();

    fireEvent.click(screen.getByText("Згорнути"));
    expect(screen.getByText("Показати повністю")).toBeDefined();
  });
});
