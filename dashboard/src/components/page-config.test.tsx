// Тестує src/app/config/page.tsx (ConfigPage) — групування шляхів по директорії
// (groupByDir, не експортована) і гілки помилок, не сам рендер: викликаємо
// асинхронну функцію напряму й обходимо повернене дерево React-елементів без
// монтування в DOM (той самий підхід, що й у page-home.test.tsx).
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ComponentType, ReactElement, ReactNode } from "react";

const { listConfigPaths, configSourceLabel } = vi.hoisted(() => ({
  listConfigPaths: vi.fn(),
  configSourceLabel: vi.fn(() => "мітка джерела"),
}));
vi.mock("@/lib/config-files", () => ({ listConfigPaths, configSourceLabel }));

const { getConfigSource, getGithubEnv } = vi.hoisted(() => ({
  getConfigSource: vi.fn(),
  getGithubEnv: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ getConfigSource, getGithubEnv }));

import ConfigPage from "@/app/config/page";
import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import Link from "next/link";

// P виводиться з ComponentType<P> самого компонента (напр. ConfigNotice ->
// {title, vars}) — окремо генерик у місцях виклику вказувати не треба.
// Для рядкових тегів (напр. "h2") P лишається дефолтним {children}.
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
  listConfigPaths.mockReset();
  configSourceLabel.mockReset().mockReturnValue("мітка джерела");
  getConfigSource.mockReset();
  getGithubEnv.mockReset();
});

test("CONFIG_SOURCE=github без GITHUB_TOKEN -> ConfigNotice, listConfigPaths не викликається", async () => {
  getConfigSource.mockReturnValue("github");
  getGithubEnv.mockReturnValue(null);
  const el = await ConfigPage();
  const notice = findByType(el, ConfigNotice);
  expect(notice).toHaveLength(1);
  expect(notice[0].props.title).toBe("Немає доступу до GitHub");
  expect(listConfigPaths).not.toHaveBeenCalled();
});

test("CONFIG_SOURCE=github з токеном -> listConfigPaths викликається", async () => {
  getConfigSource.mockReturnValue("github");
  getGithubEnv.mockReturnValue({ token: "x" });
  listConfigPaths.mockResolvedValue([]);
  await ConfigPage();
  expect(listConfigPaths).toHaveBeenCalledTimes(1);
});

test("CONFIG_SOURCE=local -> перевірка GITHUB_TOKEN не застосовується взагалі", async () => {
  getConfigSource.mockReturnValue("local");
  getGithubEnv.mockReturnValue(null);
  listConfigPaths.mockResolvedValue([]);
  const el = await ConfigPage();
  expect(findByType(el, ConfigNotice)).toHaveLength(0);
});

test("listConfigPaths кидає помилку -> ConfigNotice з текстом помилки", async () => {
  getConfigSource.mockReturnValue("local");
  listConfigPaths.mockRejectedValue(new Error("диск недоступний"));
  const el = await ConfigPage();
  const notice = findByType(el, ConfigNotice);
  expect(notice[0].props.title).toContain("диск недоступний");
});

test("listConfigPaths кидає не-Error -> 'Невідома помилка'", async () => {
  getConfigSource.mockReturnValue("local");
  listConfigPaths.mockRejectedValue("щось дивне");
  const el = await ConfigPage();
  const notice = findByType(el, ConfigNotice);
  expect(notice[0].props.title).toContain("Невідома помилка");
});

test("порожній перелік -> EmptyState", async () => {
  getConfigSource.mockReturnValue("local");
  listConfigPaths.mockResolvedValue([]);
  const el = await ConfigPage();
  expect(findByType(el, EmptyState)).toHaveLength(1);
});

describe("groupByDir — групування й сортування", () => {
  test("файли групуються по директорії, посилання ведуть на /config/<шлях>", async () => {
    getConfigSource.mockReturnValue("local");
    // groupByDir лише групує й сортує групи — файли всередині групи йдуть у
    // порядку, який прийшов від listConfigPaths (сама вона вже повертає
    // відсортований перелік, тому на практиці порядок алфавітний).
    listConfigPaths.mockResolvedValue([
      "agents/prompts/analyst.md",
      "agents/prompts/collector.md",
      "shared/contracts.md",
    ]);
    const el = await ConfigPage();
    const links = findByType(el, Link);
    expect(links.map((l) => l.props.href)).toEqual([
      "/config/agents/prompts/analyst.md",
      "/config/agents/prompts/collector.md",
      "/config/shared/contracts.md",
    ]);
  });

  test("файли всередині групи НЕ сортуються самим groupByDir — зберігається вхідний порядок", async () => {
    getConfigSource.mockReturnValue("local");
    listConfigPaths.mockResolvedValue([
      "agents/prompts/z-last.md",
      "agents/prompts/a-first.md",
    ]);
    const el = await ConfigPage();
    const links = findByType(el, Link);
    expect(links.map((l) => l.props.href)).toEqual([
      "/config/agents/prompts/z-last.md",
      "/config/agents/prompts/a-first.md",
    ]);
  });

  test("групи директорій відсортовані за localeCompare (agents/prompts перед shared)", async () => {
    getConfigSource.mockReturnValue("local");
    listConfigPaths.mockResolvedValue(["shared/z.md", "agents/prompts/a.md"]);
    const el = await ConfigPage();
    const headers = findByType(el, "h2");
    expect(headers.map((h) => h.props.children)).toEqual(["agents/prompts", "shared"]);
  });

  test("файл без директорії (шлях без '/') групується під заголовком '/'", async () => {
    getConfigSource.mockReturnValue("local");
    listConfigPaths.mockResolvedValue(["shared"]);
    const el = await ConfigPage();
    const headers = findByType(el, "h2");
    expect(headers.map((h) => h.props.children)).toEqual(["/"]);
  });
});
