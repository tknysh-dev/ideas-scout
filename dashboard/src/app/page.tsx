import { Suspense } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import IdeaTree from "@/components/IdeaTree";
import TreeFilters from "@/components/TreeFilters";
import { getServiceClient } from "@/lib/supabase/service";
import { buildIdeaTree } from "@/lib/tree";
import type { Idea } from "@/lib/types";

const DEFAULT_TRACKS = ["passive-income", "app-ideas"];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ track?: string; status?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const supabase = getServiceClient();

  if (!supabase) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <ConfigNotice
          title="Немає доступу до бази"
          vars={["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]}
        />
      </div>
    );
  }

  const { data: trackRows } = await supabase.from("ideas").select("track");
  const counts: Record<string, number> = {};
  for (const row of trackRows ?? []) {
    const key = row.track as string;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  // Треки — це вкладки, тому показуємо всі відомі, навіть порожні: інакше трек
  // без жодної ідеї просто зникає з інтерфейсу і виглядає як зламаний.
  const availableTracks = Array.from(new Set([...DEFAULT_TRACKS, ...Object.keys(counts)]));

  const track = params.track ?? availableTracks[0];
  // Параметра немає — фільтр не задавали (показуємо все); порожній рядок — усі
  // галочки зняті, тобто свідомо нічого. Це різні стани, і зводити їх не можна.
  const statuses =
    params.status === undefined ? null : params.status.split(",").filter(Boolean);
  const sort = params.sort === "asc" ? "asc" : "desc";

  const { data, error } = await supabase
    .from("ideas")
    .select("*")
    .eq("track", track);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <ConfigNotice title={`Помилка запиту до Supabase: ${error.message}`} vars={[]} />
      </div>
    );
  }

  const ideas = (data ?? []) as Idea[];
  const nodes = buildIdeaTree(
    ideas,
    (idea) => statuses === null || statuses.includes(idea.status),
    sort,
  );

  return (
    <div className="px-8 py-10">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-ink">Дерево знахідок</h1>
      </header>

      <Suspense>
        <TreeFilters tracks={availableTracks} counts={counts} />
      </Suspense>

      <div className="mt-2">
        {nodes.length === 0 ? (
          <EmptyState
            title="У цьому треку поки немає знахідок"
            hint={
              statuses !== null
                ? "Спробуй прибрати фільтр за статусом — можливо, підходящих записів просто ще немає."
                : "Щойно збирач або власник додасть ідею — вона з'явиться тут."
            }
          />
        ) : (
          <IdeaTree nodes={nodes} />
        )}
      </div>
    </div>
  );
}
