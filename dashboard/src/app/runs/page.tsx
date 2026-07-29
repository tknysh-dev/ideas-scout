import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import RunsTable from "@/components/RunsTable";
import { getServiceClient } from "@/lib/supabase/service";
import type { RunRow } from "@/lib/types";

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

  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false });

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
          Журнал прогонів
        </p>
        <h1 className="font-display text-3xl text-ink">Прогони</h1>
      </header>

      {error ? (
        <ConfigNotice title={`Помилка запиту до Supabase: ${error.message}`} vars={[]} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Прогонів ще не було"
          hint="Тут з'являться записи джобів збирача, аналітика, ревізора й тріажу."
        />
      ) : (
        <RunsTable runs={data as RunRow[]} />
      )}
    </div>
  );
}
