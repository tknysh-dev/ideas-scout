import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import JobsTable from "@/components/JobsTable";
import RunsTable from "@/components/RunsTable";
import { getServiceClient } from "@/lib/supabase/service";
import type { JobRow, RunRow } from "@/lib/types";

// Читаємо базу при кожному відкритті, інакше сторінка запікається на момент деплою.
export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const supabase = getServiceClient();

  if (!supabase) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <ConfigNotice
          title="Немає доступу до бази"
          vars={["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]}
        />
      </div>
    );
  }

  const [jobsResult, runsResult] = await Promise.all([
    supabase.from("jobs").select("*").order("created_at", { ascending: false }).limit(20),
    supabase.from("runs").select("*").order("started_at", { ascending: false }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
          Журнал прогонів
        </p>
        <h1 className="font-display text-3xl text-ink">Прогони</h1>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 font-display text-xl text-ink">Черга M1</h2>
        {jobsResult.error ? (
          <ConfigNotice
            title={`Помилка читання jobs: ${jobsResult.error.message}`}
            vars={[]}
          />
        ) : !jobsResult.data || jobsResult.data.length === 0 ? (
          <EmptyState
            title="Черга порожня"
            hint="Тут з'являться команди, передані локальному worker на M1."
          />
        ) : (
          <JobsTable jobs={jobsResult.data as JobRow[]} />
        )}
      </section>

      <h2 className="mb-3 font-display text-xl text-ink">Історія виконання</h2>
      {runsResult.error ? (
        <ConfigNotice
          title={`Помилка запиту до Supabase: ${runsResult.error.message}`}
          vars={[]}
        />
      ) : !runsResult.data || runsResult.data.length === 0 ? (
        <EmptyState
          title="Прогонів ще не було"
          hint="Тут з'являться записи джобів збирача, аналітика, ревізора й тріажу."
        />
      ) : (
        <RunsTable runs={runsResult.data as RunRow[]} />
      )}
    </div>
  );
}
