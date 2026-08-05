import type { Element, ElementContent, Root } from "hast";
// Відносний шлях замість "@/lib/idea-refs": плейн `node --test` (без next-резолвера
// tsconfig-шляхів) не вміє резолвити аліас "@/*", а сам модуль лишається тим самим.
import { IDEA_ID_PATTERN } from "./idea-refs.ts";

const SKIP_TAGS = new Set(["code", "pre", "a"]);

// Замінює згадки id ідей у тексті на <idearef data-idea-id="PI-0011"/>, який
// react-markdown рендерить нашим компонентом-пігулкою. Всередині коду і вже
// наявних посилань не чіпаємо, щоб не ламати цитати і URL.
export default function rehypeIdeaRefs(known: Set<string>) {
  return () => (tree: Root) => {
    walk(tree as unknown as Element);
  };

  function walk(node: Element | Root) {
    const children = node.children as ElementContent[];
    if (!children) return;
    const next: ElementContent[] = [];
    let changed = false;

    for (const child of children) {
      if (child.type === "element") {
        if (!SKIP_TAGS.has(child.tagName)) walk(child);
        next.push(child);
        continue;
      }
      if (child.type !== "text") {
        next.push(child);
        continue;
      }

      const parts = split(child.value, known);
      if (!parts) {
        next.push(child);
        continue;
      }
      changed = true;
      next.push(...parts);
    }

    if (changed) node.children = next as Root["children"];
  }
}

function split(value: string, known: Set<string>): ElementContent[] | null {
  IDEA_ID_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  let cursor = 0;
  const out: ElementContent[] = [];

  while ((match = IDEA_ID_PATTERN.exec(value))) {
    if (!known.has(match[0])) continue;
    if (match.index > cursor) {
      out.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    out.push({
      type: "element",
      tagName: "idearef",
      properties: { "data-idea-id": match[0] },
      children: [],
    });
    cursor = match.index + match[0].length;
  }

  if (!out.length) return null;
  if (cursor < value.length) out.push({ type: "text", value: value.slice(cursor) });
  return out;
}
