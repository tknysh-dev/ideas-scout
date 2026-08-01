import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import IdeaRefPill from "@/components/IdeaRefPill";
import { IDEA_ID_PATTERN, type IdeaRef } from "@/lib/idea-refs";

const SKIP_TAGS = new Set(["code", "pre"]);

// Prose приймає текст рядком у props.content, а не дітьми. Обидва обходи знають
// про це одне іменоване виключення — інакше markdown-тіло всередині картки
// лишилось би без пігулок.
const TEXT_PROP = "content";

type AnyElement = ReactElement<Record<string, unknown>>;

function props(element: AnyElement) {
  return element.props as Record<string, unknown>;
}

// Всередину вже наявного посилання не заходимо: вкладене <a> — невалідний HTML,
// а сам текст посилання id ідей практично не містить.
function isOpaque(element: AnyElement) {
  const p = props(element);
  if (p.href !== undefined) return true;
  return typeof element.type === "string" && SKIP_TAGS.has(element.type);
}

export function collectText(node: ReactNode, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return;
  }
  if (!isValidElement(node)) return;

  const element = node as AnyElement;
  const p = props(element);
  if (typeof p[TEXT_PROP] === "string") out.push(p[TEXT_PROP] as string);
  if (isOpaque(element)) return;
  collectText(p.children as ReactNode, out);
}

export function linkify(node: ReactNode, refs: Record<string, IdeaRef>): ReactNode {
  if (typeof node === "string") return splitText(node, refs);
  if (Array.isArray(node)) {
    return Children.map(node, (child) => linkify(child, refs));
  }
  if (!isValidElement(node)) return node;

  const element = node as AnyElement;
  if (isOpaque(element)) return element;

  const p = props(element);
  const patch: Record<string, unknown> = {};

  // Компонент, що сам рендерить markdown із рядка (Prose), отримує довідник —
  // розбір тексту там уже свій, rehype-плагін.
  if (typeof element.type !== "string" && typeof p[TEXT_PROP] === "string" && !p.ideaRefs) {
    patch.ideaRefs = refs;
  }

  const children = p.children as ReactNode;
  if (children !== undefined && typeof children !== "function") {
    patch.children = linkify(children, refs);
  }

  return Object.keys(patch).length > 0 ? cloneElement(element, patch) : element;
}

function splitText(value: string, refs: Record<string, IdeaRef>): ReactNode {
  IDEA_ID_PATTERN.lastIndex = 0;
  const out: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = IDEA_ID_PATTERN.exec(value))) {
    const ref = refs[match[0]];
    if (!ref) continue;
    if (match.index > cursor) out.push(value.slice(cursor, match.index));
    out.push(<IdeaRefPill key={`${match[0]}-${match.index}`} idea={ref} />);
    cursor = match.index + match[0].length;
  }

  if (out.length === 0) return value;
  if (cursor < value.length) out.push(value.slice(cursor));
  return out;
}
