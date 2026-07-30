import Link from "next/link";
import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import { configSourceLabel, listConfigPaths } from "@/lib/config-files";
import { getConfigSource, getGithubEnv } from "@/lib/config";

// Локальне джерело — файли на диску; кеш сторінки означав би, що правку видно
// лише через 5 хвилин. Кеш запитів до GitHub API живе в самому lib/github.ts.
export const dynamic = "force-dynamic";

function groupByDir(paths: string[]) {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const dir = path.split("/").slice(0, -1).join("/");
    const list = groups.get(dir) ?? [];
    list.push(path);
    groups.set(dir, list);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export default async function ConfigPage() {
  if (getConfigSource() === "github" && !getGithubEnv()) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <ConfigNotice title="Немає доступу до GitHub" vars={["GITHUB_TOKEN"]} />
      </div>
    );
  }

  let paths: string[] = [];
  let fetchError: string | null = null;
  try {
    paths = await listConfigPaths();
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Невідома помилка";
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
          {configSourceLabel()}
        </p>
        <h1 className="font-display text-3xl text-ink">Конфігурація</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-dim">
          Промпти, критерії, каталоги можливостей і спільні контракти — напряму з репозиторію.
        </p>
      </header>

      {fetchError ? (
        <ConfigNotice title={`Не вдалося прочитати конфігурацію: ${fetchError}`} vars={[]} />
      ) : paths.length === 0 ? (
        <EmptyState title="У дозволених директоріях поки немає файлів" />
      ) : (
        <div className="space-y-6">
          {groupByDir(paths).map(([dir, files]) => (
            <section key={dir}>
              <h2 className="mb-2 font-mono text-xs uppercase tracking-widest text-ink-dim">
                {dir || "/"}
              </h2>
              <ul className="divide-y divide-line/60 rounded-lg border border-line bg-paper-raised">
                {files.map((file) => (
                  <li key={file}>
                    <Link
                      href={`/config/${file}`}
                      className="flex items-center justify-between px-4 py-2.5 text-sm text-ink transition-colors hover:bg-paper hover:text-accent"
                    >
                      <span>{file.split("/").pop()}</span>
                      <span className="font-mono text-xs text-ink-dim">{file}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
