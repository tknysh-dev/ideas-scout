import { describe, expect, test } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import DeepResearchTabs from "./DeepResearchTabs";

function makeTabs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    provider: `Provider${i}`,
    count: i + 1,
    panel: <p>Панель {i}</p>,
  }));
}

describe("DeepResearchTabs — порожній набір", () => {
  test("без вкладок компонент не рендерить нічого", () => {
    const { container } = render(<DeepResearchTabs tabs={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("DeepResearchTabs — стан за замовчуванням", () => {
  test("перша вкладка активна, її панель видима, решта прихована", () => {
    render(<DeepResearchTabs tabs={makeTabs(3)} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    expect(tabs[2].getAttribute("aria-selected")).toBe("false");

    // queryByText не враховує атрибут hidden (лише getByRole фільтрує невидиме),
    // тож видимість панелі перевіряємо через єдину знайдену getByRole("tabpanel").
    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    expect(within(panels[0]).getByText("Панель 0")).toBeDefined();
  });

  test("лічильник провайдера показується поруч з назвою", () => {
    render(<DeepResearchTabs tabs={makeTabs(2)} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0].textContent).toContain("Provider0");
    expect(tabs[0].textContent).toContain("1");
    expect(tabs[1].textContent).toContain("2");
  });

  test("лише перша вкладка в порядку табуляції (tabIndex 0), решта -1", () => {
    render(<DeepResearchTabs tabs={makeTabs(3)} />);
    const tabs = screen.getAllByRole("tab") as HTMLButtonElement[];
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
    expect(tabs[2].tabIndex).toBe(-1);
  });
});

describe("DeepResearchTabs — перемикання клацанням", () => {
  test("клік по вкладці робить її активною і показує її панель", () => {
    render(<DeepResearchTabs tabs={makeTabs(3)} />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[2]);

    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("aria-selected")).toBe("false");
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Панель 2")).toBeDefined();
  });
});

describe("DeepResearchTabs — навігація клавіатурою", () => {
  test("ArrowRight переходить на наступну вкладку і фокусує її", () => {
    render(<DeepResearchTabs tabs={makeTabs(3)} />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
  });

  test("ArrowRight на останній вкладці циклічно переходить на першу", () => {
    render(<DeepResearchTabs tabs={makeTabs(3)} />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[2]);
    fireEvent.keyDown(tabs[2], { key: "ArrowRight" });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  test("ArrowLeft на першій вкладці циклічно переходить на останню", () => {
    render(<DeepResearchTabs tabs={makeTabs(3)} />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
  });

  test("Home переходить на першу вкладку", () => {
    render(<DeepResearchTabs tabs={makeTabs(3)} />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs[1]);
    fireEvent.keyDown(tabs[1], { key: "Home" });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });

  test("End переходить на останню вкладку", () => {
    render(<DeepResearchTabs tabs={makeTabs(3)} />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
  });

  test("з однією вкладкою Home/End/ArrowRight лишають її активною", () => {
    render(<DeepResearchTabs tabs={makeTabs(1)} />);
    const tabs = screen.getAllByRole("tab");
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0], { key: "Home" });
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });
});

describe("DeepResearchTabs — доступність", () => {
  test("панель посилається на активну вкладку через aria-labelledby/aria-controls", () => {
    render(<DeepResearchTabs tabs={makeTabs(2)} />);
    const tabs = screen.getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");
    expect(tabs[0].getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0].id);
  });
});
