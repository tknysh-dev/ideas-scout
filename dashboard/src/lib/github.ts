import "server-only";
import { getGithubEnv } from "@/lib/config";

const ALLOWED_ROOTS = ["agents/prompts", "agents/criteria", "agents/catalogs", "shared"];

export interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree";
}

export interface GithubFile {
  path: string;
  content: string;
  sha: string;
}

export interface GithubCommitInfo {
  date: string | null;
  message: string | null;
}

function isAllowedPath(path: string): boolean {
  return ALLOWED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

async function ghFetch(path: string, revalidate = 300) {
  const env = getGithubEnv();
  if (!env) throw new Error("GITHUB_TOKEN не налаштовано");
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${env.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    next: { revalidate },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} відповів ${res.status}`);
  }
  return res.json();
}

export async function fetchConfigTree(): Promise<GithubTreeEntry[]> {
  const env = getGithubEnv();
  if (!env) throw new Error("GITHUB_TOKEN не налаштовано");
  const data = await ghFetch(
    `/repos/${env.owner}/${env.repo}/git/trees/${env.branch}?recursive=1`,
  );
  const tree = (data.tree ?? []) as GithubTreeEntry[];
  return tree.filter((entry) => entry.type === "blob" && isAllowedPath(entry.path));
}

export async function fetchConfigFile(path: string): Promise<GithubFile> {
  if (!isAllowedPath(path)) throw new Error("Шлях поза дозволеними директоріями");
  const env = getGithubEnv();
  if (!env) throw new Error("GITHUB_TOKEN не налаштовано");
  const data = await ghFetch(
    `/repos/${env.owner}/${env.repo}/contents/${path}?ref=${env.branch}`,
  );
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return { path, content, sha: data.sha };
}

export async function fetchLastCommit(path: string): Promise<GithubCommitInfo> {
  const env = getGithubEnv();
  if (!env) throw new Error("GITHUB_TOKEN не налаштовано");
  const data = await ghFetch(
    `/repos/${env.owner}/${env.repo}/commits?path=${encodeURIComponent(path)}&sha=${env.branch}&per_page=1`,
  );
  const commit = Array.isArray(data) ? data[0] : null;
  return {
    date: commit?.commit?.author?.date ?? null,
    message: commit?.commit?.message ?? null,
  };
}

export { ALLOWED_ROOTS };
