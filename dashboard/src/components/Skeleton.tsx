// Кістяки — чистий CSS (клас .skeleton у globals.css): вони показуються саме
// тоді, коли клієнтський JS ще вантажиться, тож не мають від нього залежати.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-md ${className}`} />;
}

export function SkeletonHeader() {
  return (
    <header className="mb-6">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-3 h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
    </header>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-line bg-paper-raised p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-5 w-2/3" />
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className={`mt-2 h-3.5 ${index === lines - 1 ? "w-3/5" : ""}`} />
      ))}
    </div>
  );
}

// Ширини колонок у rem — саме фіксовані, а не частки вільного місця: на
// широкому моніторі розтягнута смуга перетворюється на лінію через увесь екран
// і на таблицю вже не схожа. Права частина рядка лишається порожньою, як у
// справжній таблиці з короткими значеннями.
const TABLE_COLUMNS = [5, 18, 6, 8, 5, 7, 6];

// Тонка різниця ширин по рядках — щоб колонка читалась як текст різної довжини,
// а не як намальована сітка. Формула детермінована: випадковість тут дала б
// різний HTML на сервері й клієнті.
function jitter(row: number, column: number) {
  return 1 - ((row * 7 + column * 3) % 5) / 20;
}

export function SkeletonRows({
  rows = 8,
  columns = TABLE_COLUMNS,
}: {
  rows?: number;
  columns?: number[];
}) {
  return (
    <div className="divide-y divide-line/60 rounded-lg border border-line bg-paper-raised">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex items-center gap-6 px-4 py-3.5">
          {columns.map((width, column) => (
            <div
              key={column}
              aria-hidden
              className={`skeleton h-3 shrink-0 rounded-md ${
                column >= 3 ? "hidden md:block" : ""
              }`}
              style={{ width: `${(width * jitter(row, column)).toFixed(2)}rem` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
