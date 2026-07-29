import { Suspense } from "react";
import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import IdeaTree from "@/components/IdeaTree";
import TreeFilters from "@/components/TreeFilters";
import { getServiceClient } from "@/lib/supabase/service";
import { buildIdeaTree } from "@/lib/tree";
import type { Idea } from "@/lib/types";
import { trackLabel } from "@/lib/status";

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
  const tracks = Array.from(
    new Set((trackRows ?? []).map((r) => r.track as string)),
  ).sort();
  const availableTracks = tracks.length > 0 ? tracks : DEFAULT_TRACKS;

  const track = params.track ?? availableTracks[0];
  const status = params.status ?? "";
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
    (idea) => (status ? idea.status === status : true),
    sort,
  );

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
          {trackLabel(track)}
        </p>
        <h1 className="font-display text-3xl text-ink">Дерево знахідок</h1>
      </header>

      <Suspense>
        <TreeFilters tracks={availableTracks} />
      </Suspense>

      <div className="mt-4">
        {nodes.length === 0 ? (
          <EmptyState
            title="У цьому треку поки немає знахідок"
            hint={
              status
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
