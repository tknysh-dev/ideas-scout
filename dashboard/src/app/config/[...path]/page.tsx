import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ConfigNotice from "@/components/ConfigNotice";
import { fetchConfigFile, fetchLastCommit } from "@/lib/github";
import { getGithubEnv } from "@/lib/config";

export const revalidate = 300;

function formatDateTime(value: string | null) {
  if (!value) return "невідомо";
  return new Date(value).toLocaleString("uk-UA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
        <div className="prose prose-neutral max-w-none rounded-lg border border-line bg-paper-raised p-6 prose-headings:font-display prose-a:text-accent">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <pre className="overflow-x-auto rounded-lg border border-line bg-paper-raised p-6 text-sm text-ink">
          {content}
        </pre>
      )}
    </div>
  );
}
