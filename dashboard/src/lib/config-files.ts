import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  ALLOWED_ROOTS,
  fetchConfigFile,
  fetchConfigTree,
  fetchLastCommit,
} from "@/lib/github";
import { getConfigSource } from "@/lib/config";

export interface ConfigFileContent {
  content: string;
  // Дата останньої зміни: коміт у GitHub або mtime файлу в робочій копії.
  changed: string | null;
}

// Локальний режим читає робочу копію репозиторію, а не GitHub, — тому дашборд
// на localhost показує ще не закомічені правки критеріїв, промптів і контрактів.
function localRoot() {
  return process.env.CONFIG_LOCAL_ROOT ?? resolve(process.cwd(), "..");
}

function isAllowedPath(path: string) {
  return ALLOWED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

function resolveLocal(path: string) {
  if (!isAllowedPath(path)) throw new Error("Шлях поза дозволеними директоріями");
  const root = localRoot();
  const full = resolve(root, path);
  if (!full.startsWith(`${root}${sep}`)) {
    throw new Error("Шлях поза дозволеними директоріями");
  }
  return full;
}

async function walk(dir: string, prefix: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...(await walk(join(dir, entry.name), rel)));
    else if (entry.isFile()) paths.push(rel);
  }
  return paths;
}

export async function listConfigPaths(): Promise<string[]> {
  if (getConfigSource() === "github") {
    const entries = await fetchConfigTree();
    return entries.map((entry) => entry.path).sort();
  }
  const root = localRoot();
  const lists = await Promise.all(ALLOWED_ROOTS.map((r) => walk(join(root, r), r)));
  return lists.flat().sort();
}

export async function readConfigFile(path: string): Promise<ConfigFileContent> {
  if (getConfigSource() === "github") {
    const [file, commit] = await Promise.all([
      fetchConfigFile(path),
      fetchLastCommit(path),
    ]);
    return { content: file.content, changed: commit.date };
  }
  const full = resolveLocal(path);
  const [content, info] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
  return { content, changed: info.mtime.toISOString() };
}

export function configSourceLabel() {
  return getConfigSource() === "github"
    ? "tknysh-dev/ideas-scout · main"
    : `робоча копія · ${localRoot()}`;
}

export function configChangedLabel() {
  return getConfigSource() === "github" ? "останній коміт" : "змінено";
}
