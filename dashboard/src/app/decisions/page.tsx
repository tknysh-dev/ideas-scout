import Link from "next/link";
import Card from "@/components/Card";
import ConfigNotice from "@/components/ConfigNotice";
import DecisionPanel from "@/components/DecisionPanel";
import EmptyState from "@/components/EmptyState";
import StatusBadge from "@/components/StatusBadge";
import { getServiceClient } from "@/lib/supabase/service";
import { trackLabel } from "@/lib/status";
import type { Idea } from "@/lib/types";

// Читаємо базу при кожному відкритті, інакше сторінка запікається на момент деплою.
export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
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

  const { data, error } = await supabase
    .from("ideas")
    .select("*")
    .eq("status", "approved_pending")
    .order("discovered", { ascending: false });

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <ConfigNotice title={`Помилка запиту до Supabase: ${error.message}`} vars={[]} />
      </div>
    );
  }

  const ideas = (data ?? []) as Idea[];

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
          Черга власника
        </p>
        <h1 className="font-display text-3xl text-ink">Рішення</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-dim">
          Ідеї у статусі «Очікує рішення» — пройшли формальні фільтри, останнє слово завжди за
          власником.
        </p>
      </header>

      {ideas.length === 0 ? (
        <EmptyState
          title="Черга порожня"
          hint="Щойно аналітик виведе ідею в «Очікує рішення» — вона з'явиться тут."
        />
      ) : (
        <ul className="space-y-6">
          {ideas.map((idea, index) => (
            <Card as="li" key={idea.id} index={index} exclude={idea.id}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
                    {trackLabel(idea.track)} · {idea.id}
                  </p>
                  <Link
                    href={`/ideas/${idea.id}`}
                    className="font-display text-xl text-ink hover:text-accent"
                  >
                    {idea.title}
                  </Link>
                  {idea.mechanic_summary && (
                    <p className="mt-1 max-w-2xl text-sm text-ink-dim">{idea.mechanic_summary}</p>
                  )}
                </div>
                <StatusBadge status={idea.status} />
              </div>
              <DecisionPanel ideaId={idea.id} currentStatus={idea.status} compact />
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
