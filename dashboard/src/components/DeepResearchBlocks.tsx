import Card from "@/components/Card";
import VerdictDetails, { Pill } from "@/components/VerdictDetails";
import {
  DEEP_BLOCKS,
  TONE_META,
  VERDICT_TONE,
  type CriterionVerdicts,
  type DeepResearchData,
} from "@/lib/deep-research";

export default function DeepResearchBlocks({
  data,
  ideaId,
}: {
  data: DeepResearchData;
  ideaId?: string;
}) {
  const blocks = DEEP_BLOCKS.map((block) => ({ block, entry: data.byKey.get(block.key) })).filter(
    (item): item is { block: (typeof DEEP_BLOCKS)[number]; entry: CriterionVerdicts } =>
      Boolean(item.entry && (item.entry.synthesis || item.entry.models.length > 0)),
  );

  if (blocks.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
        Глибоке дослідження: додаткові блоки
      </h2>
      <p className="mb-3 text-sm text-ink-dim">
        Ці блоки покривають те, чого базовий чек-лист критеріїв не оцінює. Самі по собі вони ідею
        не відхиляють — лише дають підстави переглянути базові критерії вище.
      </p>

      <ul className="space-y-3">
        {blocks.map(({ block, entry }, index) => {
          const meta = entry.synthesis ? TONE_META[VERDICT_TONE[entry.synthesis.verdict]] : null;
          return (
            <Card as="li" key={block.key} index={index} padding="sm" exclude={ideaId}>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1"
                  title={block.hint}
                >
                  <span className="text-sm text-ink">{block.title}</span>
                </span>
                {meta ? (
                  <Pill label={meta.label} token={meta.token} />
                ) : (
                  <Pill label="лише моделі" token="transferred" />
                )}
              </div>

              {entry.synthesis?.summary && (
                <p className="mt-3 text-sm text-ink-dim first-letter:uppercase">
                  {entry.synthesis.summary}
                </p>
              )}

              <VerdictDetails entry={entry} />
            </Card>
          );
        })}
      </ul>
    </section>
  );
}
