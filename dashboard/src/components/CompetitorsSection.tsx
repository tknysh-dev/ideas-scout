import Card from "@/components/Card";
import Pill from "@/components/Pill";
import { formatDate } from "@/lib/dates";
import { LIVENESS_META, parseEvidence } from "@/lib/deep-research";
import type { CompetitorRow } from "@/lib/types";

export default function CompetitorsSection({
  competitors,
  ideaId,
}: {
  competitors: CompetitorRow[];
  ideaId?: string;
}) {
  if (competitors.length === 0) return null;

  const counts = { active: 0, stale: 0, dead: 0 };
  for (const competitor of competitors) {
    if (competitor.liveness) counts[competitor.liveness] += 1;
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
        Конкуренти
      </h2>
      <p className="mb-3 text-sm text-ink-dim">
        Живих: {counts.active} · Застиглих: {counts.stale} · Мертвих: {counts.dead}
      </p>

      <ul className="space-y-3">
        {competitors.map((competitor, index) => {
          const evidence = parseEvidence(competitor.evidence);
          const liveness = competitor.liveness ? LIVENESS_META[competitor.liveness] : null;
          const hasMeta = Boolean(competitor.pricing || competitor.last_activity);
          const hasDetails =
            hasMeta ||
            Boolean(competitor.url || competitor.strengths || competitor.weaknesses || competitor.differentiation) ||
            evidence.length > 0;

          const header = (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <span className="flex min-w-0 items-center gap-2 break-words font-medium text-ink">
                {hasDetails && (
                  <svg
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                    className="h-3 w-3 shrink-0 text-ink-dim transition-transform duration-200 group-open:rotate-90"
                  >
                    <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                )}
                {competitor.name}
              </span>
              {liveness && <Pill label={liveness.label} token={liveness.token} />}
            </div>
          );

          const body = (
            <div className="mt-3 space-y-3">
              {competitor.url && (
                <a
                  href={competitor.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-sm text-accent hover:underline"
                >
                  {competitor.url}
                </a>
              )}

              {hasMeta && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-dim">
                  {competitor.pricing && <span>{competitor.pricing}</span>}
                  {competitor.last_activity && (
                    <span>Остання активність: {formatDate(competitor.last_activity)}</span>
                  )}
                </div>
              )}

              {competitor.strengths && (
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-wide text-ink-dim">
                    Сильні сторони
                  </p>
                  <p className="text-sm text-ink-dim">{competitor.strengths}</p>
                </div>
              )}
              {competitor.weaknesses && (
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-wide text-ink-dim">
                    Слабкі місця
                  </p>
                  <p className="text-sm text-ink-dim">{competitor.weaknesses}</p>
                </div>
              )}
              {competitor.differentiation && (
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-wide text-ink-dim">
                    Кут відриву
                  </p>
                  <p className="text-sm text-ink-dim">{competitor.differentiation}</p>
                </div>
              )}

              {evidence.length > 0 && (
                <ul className="space-y-1">
                  {evidence.map((item, evidenceIndex) => (
                    <li key={evidenceIndex} className="flex flex-wrap items-center justify-between gap-2">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-xs text-accent hover:underline"
                      >
                        {item.url}
                      </a>
                      {item.published_date && (
                        <span className="font-mono text-[11px] text-ink-dim">
                          {formatDate(item.published_date)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );

          return (
            <Card as="li" key={competitor.id} index={index} padding="sm" exclude={ideaId}>
              {hasDetails ? (
                <details className="group">
                  <summary className="cursor-pointer list-none outline-none [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-accent">
                    {header}
                  </summary>
                  {body}
                </details>
              ) : (
                header
              )}
            </Card>
          );
        })}
      </ul>
    </section>
  );
}
