// linkify.tsx і idea-refs.ts лежать у src/lib/, але цей файл живе тут:
// vitest.config.mts підхоплює лише src/components/**/*.test.tsx
// (src/lib/*.test.mts зарезервовано за node --test), інакше файл просто
// не запускався б через `npm test`.
import { isValidElement } from "react";
import { describe, expect, test } from "vitest";
import { collectText, linkify } from "@/lib/linkify";
import type { IdeaRef } from "@/lib/idea-refs";
import IdeaRefPill from "@/components/IdeaRefPill";
import Prose from "@/components/Prose";

function ref(id: string, title = `Ідея ${id}`): IdeaRef {
  return { id, title, status: "new", summary: null };
}

const REFS: Record<string, IdeaRef> = {
  "PI-0001": ref("PI-0001"),
  "APP-0013": ref("APP-0013"),
};

describe("collectText", () => {
  test("рядок збирається як є", () => {
    const out: string[] = [];
    collectText("простий текст", out);
    expect(out).toEqual(["простий текст"]);
  });

  test("масив дітей обходиться рекурсивно", () => {
    const out: string[] = [];
    collectText(["a", "b", ["c", "d"]], out);
    expect(out).toEqual(["a", "b", "c", "d"]);
  });

  test("children рядкового елемента збираються", () => {
    const out: string[] = [];
    collectText(<div>текст у div</div>, out);
    expect(out).toEqual(["текст у div"]);
  });

  test("вкладені елементи обходяться рекурсивно", () => {
    const out: string[] = [];
    collectText(
      <div>
        <span>перший</span>
        <span>другий</span>
      </div>,
      out,
    );
    expect(out).toEqual(["перший", "другий"]);
  });

  test("content-проп компонента (Prose) збирається окремо від children", () => {
    const out: string[] = [];
    collectText(<Prose content="текст із content-пропа" />, out);
    expect(out).toEqual(["текст із content-пропа"]);
  });

  test("елемент з href (посилання) — опаковий, його children НЕ збираються", () => {
    const out: string[] = [];
    collectText(<a href="https://example.com/ideas/PI-0001">PI-0001</a>, out);
    expect(out).toEqual([]);
  });

  test("тег <code> — опаковий, children не збираються", () => {
    const out: string[] = [];
    collectText(<code>PI-0001</code>, out);
    expect(out).toEqual([]);
  });

  test("тег <pre> — опаковий, children не збираються", () => {
    const out: string[] = [];
    collectText(<pre>PI-0001</pre>, out);
    expect(out).toEqual([]);
  });

  test("нетекстові/невалідні вузли ігноруються без падіння (null, boolean, number)", () => {
    const out: string[] = [];
    collectText([null, false, true, undefined, 42, "текст"], out);
    expect(out).toEqual(["текст"]);
  });
});

describe("linkify: текст без збігів", () => {
  test("рядок без ідентифікаторів повертається без змін", () => {
    expect(linkify("звичайний текст", REFS)).toBe("звичайний текст");
  });

  test("порожній рядок повертається без змін", () => {
    expect(linkify("", REFS)).toBe("");
  });

  test("формат id, якого немає у довіднику refs, лишається текстом (не падає у пігулку)", () => {
    expect(linkify("PI-9999 невідома ідея", REFS)).toBe("PI-9999 невідома ідея");
  });
});

describe("linkify: текст зі збігами", () => {
  test("один id перетворюється на IdeaRefPill, текст навколо лишається рядками", () => {
    const result = linkify("Дивись PI-0001 для деталей.", REFS) as React.ReactNode[];
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("Дивись ");
    expect(isValidElement(result[1])).toBe(true);
    expect((result[1] as React.ReactElement).type).toBe(IdeaRefPill);
    expect((result[1] as React.ReactElement<{ idea: IdeaRef }>).props.idea).toBe(REFS["PI-0001"]);
    expect(result[2]).toBe(" для деталей.");
  });

  test("кілька id підряд в одному рядку — усі перетворюються", () => {
    const result = linkify("PI-0001 і APP-0013 разом.", REFS) as React.ReactNode[];
    const pills = result.filter(isValidElement);
    expect(pills).toHaveLength(2);
    expect((pills[0] as React.ReactElement<{ idea: IdeaRef }>).props.idea).toBe(REFS["PI-0001"]);
    expect((pills[1] as React.ReactElement<{ idea: IdeaRef }>).props.idea).toBe(REFS["APP-0013"]);
  });

  test("невідомий id перед відомим не губить свій текстовий хвіст", () => {
    const result = linkify("PI-9999 але APP-0013 відомий.", REFS) as React.ReactNode[];
    expect(result[0]).toBe("PI-9999 але ");
    expect((result[1] as React.ReactElement<{ idea: IdeaRef }>).props.idea).toBe(REFS["APP-0013"]);
    expect(result[2]).toBe(" відомий.");
  });
});

describe("linkify: обхід дерева елементів", () => {
  test("масив дітей — кожен елемент лінкіфікується окремо (Children.map розгортає вкладені масиви)", () => {
    const result = linkify(["PI-0001 тут", "APP-0013 там"], REFS) as React.ReactNode[];
    const pills = result.filter(isValidElement);
    expect(pills).toHaveLength(2);
    expect((pills[0] as React.ReactElement<{ idea: IdeaRef }>).props.idea).toBe(REFS["PI-0001"]);
    expect((pills[1] as React.ReactElement<{ idea: IdeaRef }>).props.idea).toBe(REFS["APP-0013"]);
  });

  test("невалідний вузол (null, число) повертається без змін", () => {
    expect(linkify(null, REFS)).toBe(null);
    expect(linkify(42, REFS)).toBe(42);
  });

  test("елемент з href — опаковий, повертається тим самим обʼєктом, вміст не чіпається", () => {
    const el = <a href="https://example.com/x">PI-0001</a>;
    const result = linkify(el, REFS);
    expect(result).toBe(el);
  });

  test("<code> — опаковий, id всередині не перетворюється на пігулку", () => {
    const el = <code>PI-0001</code>;
    const result = linkify(el, REFS);
    expect(result).toBe(el);
  });

  test("<a> БЕЗ href-пропа не вважається опаковим — вміст усередині лінкіфікується", () => {
    const el = <a>PI-0001 текст</a>;
    const result = linkify(el, REFS) as React.ReactElement<{ children: React.ReactNode }>;
    expect(result).not.toBe(el);
    const children = result.props.children as React.ReactNode[];
    expect(children.some(isValidElement)).toBe(true);
  });

  test("вкладені DOM-елементи — рядок усередині вкладеного span перетворюється", () => {
    const result = linkify(
      <div>
        <span>PI-0001 всередині</span>
      </div>,
      REFS,
    ) as React.ReactElement<{ children: React.ReactElement<{ children: React.ReactNode }> }>;
    const span = result.props.children;
    const spanChildren = span.props.children as React.ReactNode[];
    expect(spanChildren.some(isValidElement)).toBe(true);
  });

  test("Prose (компонент із content-пропом) отримує ideaRefs, якщо його ще не було", () => {
    const el = <Prose content="PI-0001 у тілі" />;
    const result = linkify(el, REFS) as React.ReactElement<{ ideaRefs?: Record<string, IdeaRef> }>;
    expect(result).not.toBe(el);
    expect(result.props.ideaRefs).toBe(REFS);
  });

  test("Prose із вже виставленим ideaRefs — значення не перезаписується", () => {
    const ownRefs: Record<string, IdeaRef> = { "PI-0001": ref("PI-0001", "Своя назва") };
    const el = <Prose content="PI-0001 у тілі" ideaRefs={ownRefs} />;
    const result = linkify(el, REFS) as React.ReactElement<{ ideaRefs?: Record<string, IdeaRef> }>;
    expect(result.props.ideaRefs).toBe(ownRefs);
  });

  test("children-функція (render prop) не обходиться — елемент повертається без змін", () => {
    function WithRenderProp({ children }: { children: () => React.ReactNode }) {
      return <>{children()}</>;
    }
    const renderChildren = () => "PI-0001";
    const el = <WithRenderProp>{renderChildren}</WithRenderProp>;
    const result = linkify(el, REFS);
    expect(result).toBe(el);
  });
});
