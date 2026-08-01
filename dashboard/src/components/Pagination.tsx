import Link from "next/link";

// Сторінка нумерується з 1 і живе в URL: так посилання на конкретну сторінку
// журналу можна кинути собі ж у нотатки й воно відкриється туди ж.
export default function Pagination({
  page,
  pageCount,
  total,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) {
    return (
      <p className="mt-3 text-right font-mono text-xs text-ink-dim">Записів: {total}</p>
    );
  }

  const style =
    "rounded-md border border-line px-3 py-1.5 text-sm transition-colors hover:border-line-strong hover:text-ink";

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="font-mono text-xs text-ink-dim">
        Сторінка {page} з {pageCount} · записів: {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} scroll={false} className={`${style} text-ink-dim`}>
            ← Назад
          </Link>
        ) : (
          <span className={`${style} pointer-events-none text-ink-dim/40`}>← Назад</span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} scroll={false} className={`${style} text-ink-dim`}>
            Далі →
          </Link>
        ) : (
          <span className={`${style} pointer-events-none text-ink-dim/40`}>Далі →</span>
        )}
      </div>
    </nav>
  );
}
