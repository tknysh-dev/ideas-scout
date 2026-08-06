import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import JobsTable from "@/components/JobsTable";
import Pagination from "@/components/Pagination";
import RunsTable from "@/components/RunsTable";
import Tabs from "@/components/Tabs";
import { Reveal } from "@/components/motion";
import { getServiceClient } from "@/lib/supabase/service";
import type { JobRow, RunRow } from "@/lib/types";

// Читаємо базу при кожному відкритті, інакше сторінка запікається на момент деплою.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// Два різні журнали: черга M1 — це те, що власник (або бот) поставив у роботу
// вручну, а історія — те, що агенти відпрацювали самі. Раніше вони стояли одне
// під одним і довший список ховав коротший.
const TABS = {
  queue: { label: "Черга M1", table: "jobs", order: "created_at" },
  history: { label: "Історія виконання", table: "runs", order: "started_at" },
} as const;

type TabKey = keyof typeof TABS;

// Number.parseInt читає числовий префікс і мовчки відкидає решту ("5abc" -> 5,
// "2.9" -> 2) — з URL query це радше сміття, ніж сторінка, тому приймаємо лише
// рядок, що складається виключно з цифр.
const PAGE_RE = /^\d+$/;

function parsePage(value: string | undefined) {
  if (value === undefined || !PAGE_RE.test(value)) return 1;
  const page = Number(value);
  return page > 0 ? page : 1;
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const params = await searchParams;
  const tab: TabKey = params.tab === "history" ? "history" : "queue";
  const page = parsePage(params.page);
  const supabase = getServiceClient();

  if (!supabase) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
        <ConfigNotice
          title="Немає доступу до бази"
          vars={["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]}
        />
      </div>
    );
  }

  const meta = TABS[tab];
  const from = (page - 1) * PAGE_SIZE;

  // Лічильники обох табів потрібні завжди — вони стоять у самих табах; дані
  // тягнемо лише для відкритого.
  const [queueCount, historyCount, pageResult] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }),
    supabase.from("runs").select("run_id", { count: "exact", head: true }),
    supabase
      .from(meta.table)
      .select("*", { count: "exact" })
      .order(meta.order, { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
  ]);

  const total = pageResult.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = pageResult.data ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
          Журнал прогонів
        </p>
        <h1 className="font-display text-3xl text-ink">Прогони</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-dim">
          Черга M1 — задачі, поставлені в роботу вручну (глибоке дослідження, dry-run).
          Історія виконання — прогони, які агенти відпрацювали самі за розкладом.
        </p>
      </header>

      <Tabs
        active={tab}
        items={[
          {
            value: "queue",
            label: TABS.queue.label,
            href: "/runs?tab=queue",
            count: queueCount.count ?? 0,
          },
          {
            value: "history",
            label: TABS.history.label,
            href: "/runs?tab=history",
            count: historyCount.count ?? 0,
          },
        ]}
      />

      <div className="mt-5">
        {pageResult.error ? (
          <ConfigNotice
            title={`Помилка запиту до Supabase: ${pageResult.error.message}`}
            vars={[]}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={tab === "queue" ? "Черга порожня" : "Прогонів ще не було"}
            hint={
              tab === "queue"
                ? "Тут з'являться команди, передані локальному worker на M1."
                : "Тут з'являться записи джобів збирача, аналітика, ревізора й тріажу."
            }
          />
        ) : (
          <Reveal key={`${tab}-${page}`}>
            {tab === "queue" ? (
              <JobsTable jobs={rows as JobRow[]} />
            ) : (
              <RunsTable runs={rows as RunRow[]} />
            )}
            <Pagination
              page={page}
              pageCount={pageCount}
              total={total}
              hrefFor={(next) => `/runs?tab=${tab}&page=${next}`}
            />
          </Reveal>
        )}
      </div>
    </div>
  );
}
