import Link from "next/link";
import ConfigNotice from "@/components/ConfigNotice";
import Prose from "@/components/Prose";
import { configChangedLabel, readConfigFile } from "@/lib/config-files";
import { getConfigSource, getGithubEnv } from "@/lib/config";
import { formatDateTime } from "@/lib/dates";

// Локальне джерело — файли на диску; кеш сторінки означав би, що правку видно
// лише через 5 хвилин. Кеш запитів до GitHub API живе в самому lib/github.ts.
export const dynamic = "force-dynamic";

export default async function ConfigFilePage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const filePath = path.join("/");

  if (getConfigSource() === "github" && !getGithubEnv()) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
        <ConfigNotice title="Немає доступу до GitHub" vars={["GITHUB_TOKEN"]} />
      </div>
    );
  }

  let content = "";
  let changed: string | null = null;
  let fetchError: string | null = null;
  try {
    const file = await readConfigFile(filePath);
    content = file.content;
    changed = file.changed;
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Невідома помилка";
  }

  const isMarkdown = filePath.endsWith(".md") || filePath.endsWith(".mdx");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="mb-4 font-mono text-xs text-ink-dim">
        <Link href="/config" className="hover:text-accent">
          Конфігурація
        </Link>
        <span className="mx-2">/</span>
        <span>{filePath}</span>
      </div>

      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl text-ink">{filePath.split("/").pop()}</h1>
        <span className="font-mono text-xs text-ink-dim">
          {configChangedLabel()}: {formatDateTime(changed)}
        </span>
      </header>

      {fetchError ? (
        <ConfigNotice title={`Не вдалося прочитати файл: ${fetchError}`} vars={[]} />
      ) : isMarkdown ? (
        <div className="rounded-lg border border-line bg-paper-raised p-6">
          <Prose content={content} />
        </div>
      ) : (
        <pre className="overflow-x-auto rounded-lg border border-line bg-paper-raised p-6 text-sm text-ink">
          {content}
        </pre>
      )}
    </div>
  );
}
