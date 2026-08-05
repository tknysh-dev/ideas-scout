// config-files.ts лежить у src/lib/, але цей файл живе тут: vitest.config.mts
// підхоплює лише src/components/**/*.test.tsx (src/lib/*.test.mts зарезервовано
// за node --test, який не вміє vi.mock) — інакше файл просто не запускався б
// через `npm test`. Мокаємо "server-only" (маркер), "@/lib/config" (джерело
// CONFIG_SOURCE) і "@/lib/github" (мережа) — диск через node:fs/promises теж
// підмінений, жодного справжнього читання файлів.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getConfigSource } = vi.hoisted(() => ({ getConfigSource: vi.fn() }));
vi.mock("@/lib/config", () => ({ getConfigSource }));

const { fetchConfigFile, fetchConfigTree, fetchLastCommit } = vi.hoisted(() => ({
  fetchConfigFile: vi.fn(),
  fetchConfigTree: vi.fn(),
  fetchLastCommit: vi.fn(),
}));
vi.mock("@/lib/github", () => ({
  ALLOWED_ROOTS: ["agents/prompts", "agents/criteria", "agents/catalogs", "shared"],
  fetchConfigFile,
  fetchConfigTree,
  fetchLastCommit,
}));

const { readdir, readFile, stat } = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readdir,
  readFile,
  stat,
  default: { readdir, readFile, stat },
}));

import {
  configChangedLabel,
  configSourceLabel,
  listConfigPaths,
  readConfigFile,
} from "@/lib/config-files";

const LOCAL_ROOT = "/fake/repo";

function dirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir };
}

beforeEach(() => {
  getConfigSource.mockReset();
  fetchConfigFile.mockReset();
  fetchConfigTree.mockReset();
  fetchLastCommit.mockReset();
  readdir.mockReset();
  readFile.mockReset();
  stat.mockReset();
  process.env.CONFIG_LOCAL_ROOT = LOCAL_ROOT;
});

// --- CONFIG_SOURCE=github ---------------------------------------------------

describe("listConfigPaths / readConfigFile — CONFIG_SOURCE=github", () => {
  beforeEach(() => getConfigSource.mockReturnValue("github"));

  test("listConfigPaths повертає відсортовані шляхи з дерева GitHub", async () => {
    fetchConfigTree.mockResolvedValue([
      { path: "shared/contracts.md", type: "blob" },
      { path: "agents/prompts/collector.md", type: "blob" },
    ]);
    const paths = await listConfigPaths();
    expect(paths).toEqual(["agents/prompts/collector.md", "shared/contracts.md"]);
  });

  test("listConfigPaths: порожній перелік з GitHub -> []", async () => {
    fetchConfigTree.mockResolvedValue([]);
    await expect(listConfigPaths()).resolves.toEqual([]);
  });

  test("readConfigFile бере вміст із fetchConfigFile і дату з fetchLastCommit", async () => {
    fetchConfigFile.mockResolvedValue({
      path: "shared/contracts.md",
      content: "# контракти",
      sha: "abc",
    });
    fetchLastCommit.mockResolvedValue({ date: "2026-01-02T00:00:00Z", message: "fix" });
    const result = await readConfigFile("shared/contracts.md");
    expect(result).toEqual({ content: "# контракти", changed: "2026-01-02T00:00:00Z" });
  });

  test("readConfigFile: відсутній файл (fetchConfigFile кидає) -> помилка пропагується", async () => {
    fetchConfigFile.mockRejectedValue(new Error("GitHub API ... відповів 404"));
    fetchLastCommit.mockResolvedValue({ date: null, message: null });
    await expect(readConfigFile("shared/missing.md")).rejects.toThrow("404");
  });

  test("configSourceLabel і configChangedLabel для github", () => {
    expect(configSourceLabel()).toBe("tknysh-dev/ideas-scout · main");
    expect(configChangedLabel()).toBe("останній коміт");
  });
});

// --- CONFIG_SOURCE=local -----------------------------------------------------

describe("listConfigPaths / readConfigFile — CONFIG_SOURCE=local", () => {
  beforeEach(() => getConfigSource.mockReturnValue("local"));

  test("обходить усі ALLOWED_ROOTS рекурсивно і повертає відсортований перелік", async () => {
    readdir.mockImplementation(async (dir: string) => {
      if (dir === `${LOCAL_ROOT}/agents/prompts`) {
        return [dirent("collector.md", false), dirent("nested", true)];
      }
      if (dir === `${LOCAL_ROOT}/agents/prompts/nested`) {
        return [dirent("deep.md", false)];
      }
      if (dir === `${LOCAL_ROOT}/shared`) {
        return [dirent("contracts.md", false), dirent("schema.sql", false)];
      }
      return [];
    });
    const paths = await listConfigPaths();
    expect(paths).toEqual([
      "agents/prompts/collector.md",
      "agents/prompts/nested/deep.md",
      "shared/contracts.md",
      "shared/schema.sql",
    ]);
  });

  test("відсутня директорія (readdir кидає ENOENT) -> той корінь дає [], інші не постраждали", async () => {
    readdir.mockImplementation(async (dir: string) => {
      if (dir === `${LOCAL_ROOT}/agents/criteria`) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        throw err;
      }
      if (dir === `${LOCAL_ROOT}/shared`) return [dirent("contracts.md", false)];
      return [];
    });
    const paths = await listConfigPaths();
    expect(paths).toEqual(["shared/contracts.md"]);
  });

  test("жодного файлу в жодному корені -> []", async () => {
    readdir.mockResolvedValue([]);
    await expect(listConfigPaths()).resolves.toEqual([]);
  });

  test("readConfigFile читає вміст і mtime з диска", async () => {
    readFile.mockResolvedValue("# контракти\n");
    stat.mockResolvedValue({ mtime: new Date("2026-01-03T00:00:00Z") });
    const result = await readConfigFile("shared/contracts.md");
    expect(result).toEqual({ content: "# контракти\n", changed: "2026-01-03T00:00:00.000Z" });
    expect(readFile).toHaveBeenCalledWith(`${LOCAL_ROOT}/shared/contracts.md`, "utf-8");
  });

  test("readConfigFile: відсутній файл -> помилка від readFile пропагується", async () => {
    readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    stat.mockResolvedValue({ mtime: new Date() });
    await expect(readConfigFile("shared/missing.md")).rejects.toThrow("ENOENT");
  });

  test("шлях поза ALLOWED_ROOTS -> кидає без звернення до диска", async () => {
    await expect(readConfigFile("agents/scripts/runner.sh")).rejects.toThrow(
      "Шлях поза дозволеними директоріями",
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  // На відміну від github.ts, тут є другий бар'єр: full.startsWith(root+sep)
  // після resolve() ловить те, що пройшло наївний префіксний isAllowedPath.
  test("вихід за межі локального кореня через '..' — блокується другим бар'єром (resolve + startsWith)", async () => {
    await expect(readConfigFile("shared/../../etc/passwd")).rejects.toThrow(
      "Шлях поза дозволеними директоріями",
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  test("configSourceLabel показує CONFIG_LOCAL_ROOT, configChangedLabel — 'змінено'", () => {
    expect(configSourceLabel()).toBe(`робоча копія · ${LOCAL_ROOT}`);
    expect(configChangedLabel()).toBe("змінено");
  });

  test("без CONFIG_LOCAL_ROOT — localRoot() падає на resolve(cwd(), '..')", () => {
    delete process.env.CONFIG_LOCAL_ROOT;
    expect(configSourceLabel()).not.toContain(LOCAL_ROOT);
    expect(configSourceLabel().startsWith("робоча копія · ")).toBe(true);
  });
});
