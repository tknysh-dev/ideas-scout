// Тестує src/app/config/[...path]/page.tsx (ConfigFilePage) — розбір path[]
// (join, розширення для isMarkdown-гілки) і стани помилок, не сам рендер:
// викликаємо асинхронну функцію напряму й обходимо повернене дерево
// React-елементів без монтування в DOM (той самий підхід, що й у
// page-home.test.tsx).
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentType, ReactElement, ReactNode } from "react";

const { readConfigFile, configChangedLabel } = vi.hoisted(() => ({
  readConfigFile: vi.fn(),
  configChangedLabel: vi.fn(() => "мітка"),
}));
vi.mock("@/lib/config-files", () => ({ readConfigFile, configChangedLabel }));

const { getConfigSource, getGithubEnv } = vi.hoisted(() => ({
  getConfigSource: vi.fn(),
  getGithubEnv: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ getConfigSource, getGithubEnv }));

import ConfigFilePage from "@/app/config/[...path]/page";
import ConfigNotice from "@/components/ConfigNotice";
import Prose from "@/components/Prose";

// P виводиться з ComponentType<P> самого компонента (напр. ConfigNotice ->
// {title, vars}) — окремо генерик у місцях виклику вказувати не треба.
// Для рядкових тегів (напр. "pre") P лишається дефолтним {children}.
function findByType<P = { children?: ReactNode }>(
  node: unknown,
  type: ComponentType<P> | string,
  out: ReactElement<P>[] = [],
): ReactElement<P>[] {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) findByType<P>(n, type, out);
    return out;
  }
  const el = node as ReactElement<P>;
  if (el.type === type) out.push(el);
  const children = (el.props as { children?: ReactNode } | null)?.children;
  if (children !== undefined) findByType<P>(children, type, out);
  return out;
}

beforeEach(() => {
  readConfigFile.mockReset();
  configChangedLabel.mockReset().mockReturnValue("мітка");
  getConfigSource.mockReset();
  getGithubEnv.mockReset();
});

test("CONFIG_SOURCE=github без токена -> ConfigNotice, readConfigFile не викликається", async () => {
  getConfigSource.mockReturnValue("github");
  getGithubEnv.mockReturnValue(null);
  const el = await ConfigFilePage({ params: Promise.resolve({ path: ["shared", "x.md"] }) });
  expect(findByType(el, ConfigNotice)).toHaveLength(1);
  expect(readConfigFile).not.toHaveBeenCalled();
});

describe("path[] -> join('/')", () => {
  test("кілька сегментів з'єднуються слешем і передаються в readConfigFile", async () => {
    getConfigSource.mockReturnValue("local");
    readConfigFile.mockResolvedValue({ content: "текст", changed: null });
    await ConfigFilePage({ params: Promise.resolve({ path: ["agents", "prompts", "collector.md"] }) });
    expect(readConfigFile).toHaveBeenCalledWith("agents/prompts/collector.md");
  });

  test("один сегмент -> передається без слешів", async () => {
    getConfigSource.mockReturnValue("local");
    readConfigFile.mockResolvedValue({ content: "текст", changed: null });
    await ConfigFilePage({ params: Promise.resolve({ path: ["shared"] }) });
    expect(readConfigFile).toHaveBeenCalledWith("shared");
  });
});

describe("isMarkdown — вибір гілки рендеру за розширенням", () => {
  test(".md -> рендериться через Prose", async () => {
    getConfigSource.mockReturnValue("local");
    readConfigFile.mockResolvedValue({ content: "# заголовок", changed: null });
    const el = await ConfigFilePage({ params: Promise.resolve({ path: ["shared", "x.md"] }) });
    const prose = findByType(el, Prose);
    expect(prose).toHaveLength(1);
    expect(prose[0].props.content).toBe("# заголовок");
    expect(findByType(el, "pre")).toHaveLength(0);
  });

  test(".mdx -> теж рахується markdown", async () => {
    getConfigSource.mockReturnValue("local");
    readConfigFile.mockResolvedValue({ content: "# x", changed: null });
    const el = await ConfigFilePage({ params: Promise.resolve({ path: ["a", "b.mdx"] }) });
    expect(findByType(el, Prose)).toHaveLength(1);
  });

  test(".sql -> НЕ markdown, рендериться у <pre> з сирим текстом", async () => {
    getConfigSource.mockReturnValue("local");
    readConfigFile.mockResolvedValue({ content: "CREATE TABLE x();", changed: null });
    const el = await ConfigFilePage({ params: Promise.resolve({ path: ["shared", "schema.sql"] }) });
    expect(findByType(el, Prose)).toHaveLength(0);
    const pre = findByType(el, "pre");
    expect(pre).toHaveLength(1);
    expect(pre[0].props.children).toBe("CREATE TABLE x();");
  });

  test("файл без розширення -> НЕ markdown", async () => {
    getConfigSource.mockReturnValue("local");
    readConfigFile.mockResolvedValue({ content: "текст", changed: null });
    const el = await ConfigFilePage({ params: Promise.resolve({ path: ["shared", "README"] }) });
    expect(findByType(el, Prose)).toHaveLength(0);
    expect(findByType(el, "pre")).toHaveLength(1);
  });
});

test("readConfigFile кидає -> ConfigNotice з текстом помилки замість вмісту", async () => {
  getConfigSource.mockReturnValue("local");
  readConfigFile.mockRejectedValue(new Error("файл не знайдено"));
  const el = await ConfigFilePage({ params: Promise.resolve({ path: ["shared", "x.md"] }) });
  const notice = findByType(el, ConfigNotice);
  expect(notice[0].props.title).toContain("файл не знайдено");
  expect(findByType(el, Prose)).toHaveLength(0);
});

test("readConfigFile кидає не-Error -> 'Невідома помилка'", async () => {
  getConfigSource.mockReturnValue("local");
  readConfigFile.mockRejectedValue(42);
  const el = await ConfigFilePage({ params: Promise.resolve({ path: ["shared", "x.md"] }) });
  const notice = findByType(el, ConfigNotice);
  expect(notice[0].props.title).toContain("Невідома помилка");
});
