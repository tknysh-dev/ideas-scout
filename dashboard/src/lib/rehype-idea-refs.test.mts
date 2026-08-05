import assert from "node:assert/strict";
import test from "node:test";
import type { Element, Root, Text } from "hast";
import rehypeIdeaRefs from "./rehype-idea-refs.ts";

function root(children: Root["children"]): Root {
  return { type: "root", children };
}

function text(value: string): Text {
  return { type: "text", value };
}

function el(tagName: string, children: Element["children"]): Element {
  return { type: "element", tagName, properties: {}, children };
}

function run(tree: Root, known: Iterable<string>) {
  const transformer = rehypeIdeaRefs(new Set(known))();
  transformer(tree);
  return tree;
}

test("валідне посилання перетворюється на idearef", () => {
  const tree = root([text("Дивись PI-0011 для деталей.")]);
  run(tree, ["PI-0011"]);
  assert.deepEqual(tree.children, [
    text("Дивись "),
    { type: "element", tagName: "idearef", properties: { "data-idea-id": "PI-0011" }, children: [] },
    text(" для деталей."),
  ]);
});

test("кілька згадок в одному тексті — усі перетворюються", () => {
  const tree = root([text("PI-0001 і PI-0002 пов'язані.")]);
  run(tree, ["PI-0001", "PI-0002"]);
  assert.equal(tree.children.length, 4);
  assert.equal((tree.children[0] as Element).tagName, "idearef");
  assert.equal((tree.children[0] as Element).properties?.["data-idea-id"], "PI-0001");
  assert.equal((tree.children[1] as Text).value, " і ");
  assert.equal((tree.children[2] as Element).tagName, "idearef");
  assert.equal((tree.children[2] as Element).properties?.["data-idea-id"], "PI-0002");
});

test("згадка всередині <code> не перетворюється", () => {
  const codeBlock = el("code", [text("PI-0011")]);
  const tree = root([codeBlock]);
  run(tree, ["PI-0011"]);
  assert.deepEqual(tree.children, [codeBlock]);
  assert.equal((codeBlock.children[0] as Text).value, "PI-0011");
});

test("згадка всередині <pre> і вже наявного <a> так само не чіпається", () => {
  const pre = el("pre", [text("PI-0011")]);
  const link = el("a", [text("PI-0011")]);
  const tree = root([pre, link]);
  run(tree, ["PI-0011"]);
  assert.deepEqual(tree.children, [pre, link]);
});

test("текст без згадок лишається без змін", () => {
  const original = text("Звичайний текст без ідентифікаторів.");
  const tree = root([original]);
  run(tree, ["PI-0011"]);
  assert.deepEqual(tree.children, [original]);
});

test("id, що не входить у known (зареєстрований формат, невідома ідея) — лишається текстом", () => {
  const tree = root([text("Згадка PI-9999 без відповідної ідеї.")]);
  run(tree, ["PI-0011"]);
  assert.deepEqual(tree.children, [text("Згадка PI-9999 без відповідної ідеї.")]);
});

test("невідомий формат (не збігається з регуляркою) лишається текстом", () => {
  const tree = root([text("pi-0011 та PI0011 — не той формат.")]);
  run(tree, ["PI-0011"]);
  assert.deepEqual(tree.children, [text("pi-0011 та PI0011 — не той формат.")]);
});

test("невідомий id перед відомим не губить свій текст-хвіст", () => {
  const tree = root([text("PI-9999 але PI-0011 відомий.")]);
  run(tree, ["PI-0011"]);
  assert.deepEqual(tree.children, [
    text("PI-9999 але "),
    { type: "element", tagName: "idearef", properties: { "data-idea-id": "PI-0011" }, children: [] },
    text(" відомий."),
  ]);
});

test("елемент без children (void-тег) не падає — walk одразу виходить", () => {
  const voidEl = { type: "element", tagName: "br", properties: {} } as unknown as Element;
  const tree = root([voidEl]);
  run(tree, ["PI-0011"]);
  assert.deepEqual(tree.children, [voidEl]);
});

test("вузол не element і не text (напр. comment) лишається без змін", () => {
  const comment = { type: "comment", value: "PI-0011" } as unknown as Text;
  const tree = root([comment]);
  run(tree, ["PI-0011"]);
  assert.deepEqual(tree.children, [comment]);
});

test("вкладені елементи обходяться рекурсивно", () => {
  const inner = el("strong", [text("PI-0011")]);
  const tree = root([el("p", [inner])]);
  run(tree, ["PI-0011"]);
  const p = tree.children[0] as Element;
  const strong = p.children[0] as Element;
  assert.equal(strong.children.length, 1);
  assert.equal((strong.children[0] as Element).tagName, "idearef");
});
