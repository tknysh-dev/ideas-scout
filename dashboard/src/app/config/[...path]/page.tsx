import Link from "next/link";
import ConfigNotice from "@/components/ConfigNotice";
import Prose from "@/components/Prose";
import { fetchConfigFile, fetchLastCommit } from "@/lib/github";
import { getGithubEnv } from "@/lib/config";
import { formatDateTime } from "@/lib/dates";

export const revalidate = 300;


export default async function ConfigFilePage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const filePath = path.join("/");

  if (!getGithubEnv()) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <ConfigNotice title="Немає доступу до GitHub" vars={["GITHUB_TOKEN"]} />
      </div>
    );
  }

  let content = "";
  let commitDate: string | null = null;
  let fetchError: string | null = null;
  try {
    const [file, commit] = await Promise.all([
      fetchConfigFile(filePath),
      fetchLastCommit(filePath),
    ]);
    content = file.content;
    commitDate = commit.date;
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Невідома помилка";
  }

  const isMarkdown = filePath.endsWith(".md") || filePath.endsWith(".mdx");

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
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
          останній коміт: {formatDateTime(commitDate)}
        </span>
      </header>

      {fetchError ? (
        <ConfigNotice title={`Помилка GitHub API: ${fetchError}`} vars={[]} />
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
