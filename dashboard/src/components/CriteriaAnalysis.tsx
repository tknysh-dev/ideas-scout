import Card from "@/components/Card";
import CollapsibleBody from "@/components/CollapsibleBody";
import Prose from "@/components/Prose";
import VerdictDetails from "@/components/VerdictDetails";
import type { CriteriaAnalysis } from "@/lib/criteria";
import { TONE_META, type CriterionVerdicts } from "@/lib/deep-research";

export default function CriteriaAnalysisSection({
  analysis,
  verdicts,
  ideaId,
}: {
  analysis: CriteriaAnalysis;
  // Вердикти глибокого дослідження по критерію (ключ — номер критерія як
  // рядок). Необов'язковий: без глибокого дослідження картки виглядають
  // так само, як і раніше.
  verdicts?: Map<string, CriterionVerdicts>;
  ideaId?: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
        Аналіз за критеріями
      </h2>

      <ul className="space-y-3">
        {analysis.results.map(({ spec, tone, verdict, body, sharedWith }, index) => {
          const meta = TONE_META[tone];
          const shared = sharedWith && !body ? sharedWith.join(", ") : null;
          const entry = verdicts?.get(String(spec.n));
          return (
            <Card as="li" key={spec.n} index={index} padding="sm" exclude={ideaId}>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1">
                  <span className="font-mono text-[11px] text-ink-dim">{spec.n}</span>
                  <span className="text-sm text-ink">{spec.title}</span>
                  {!spec.fatal && (
                    <span
                      className="font-mono text-[10px] uppercase tracking-wide text-ink-dim"
                      title="Нефатальний критерій: сам по собі ідею не відхиляє"
                    >
                      нефатальний
                    </span>
                  )}
                </span>

                <span
                  className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide"
                  style={{
                    color: `var(--status-${meta.token}-fg)`,
                    backgroundColor: `var(--status-${meta.token}-bg)`,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: `var(--status-${meta.token}-fg)` }}
                  />
                  {meta.label}
                </span>
              </div>

              {verdict && (
                <p className="mt-3 text-sm text-ink-dim first-letter:uppercase">{verdict}</p>
              )}
              {body && (
                <div className="mt-2">
                  <CollapsibleBody>
                    <Prose content={body} />
                  </CollapsibleBody>
                </div>
              )}
              {shared && (
                <p className="mt-2 font-mono text-[11px] text-ink-dim">
                  Спільний розбір із критеріями {shared}
                </p>
              )}
              {entry && (entry.synthesis || entry.models.length > 0) && (
                <VerdictDetails entry={entry} />
              )}
            </Card>
          );
        })}
      </ul>

      {analysis.notes.map((note, index) => (
        <Card
          key={index}
          index={index}
          className="mt-3"
          accent={note.summary}
          exclude={ideaId}
        >
          <h3
            className={`mb-2 font-mono text-[11px] uppercase tracking-widest ${
              note.summary ? "text-accent" : "text-ink-dim"
            }`}
          >
            {note.title}
          </h3>
          <Prose content={note.body} />
        </Card>
      ))}
    </section>
  );
}
