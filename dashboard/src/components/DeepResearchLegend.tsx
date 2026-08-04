import Card from "@/components/Card";
import Pill from "@/components/Pill";
import {
  DISAGREEMENT_META,
  RESOLUTION_META,
  RESOLUTION_TOKEN,
  TONE_META,
  type CriterionTone,
} from "@/lib/deep-research";
import type { SynthesisResolution } from "@/lib/types";

const TONE_ORDER: CriterionTone[] = ["passed", "failed", "owner", "noted", "skipped"];
const RESOLUTION_ORDER: SynthesisResolution[] = ["consensus", "evidence", "pessimistic_default"];

// Одна легенда на сторінку ідеї: пояснює всі плашки глибокого дослідження,
// щоб не покладатись на title-hover (недоступний на мобільному).
export default function DeepResearchLegend({ ideaId }: { ideaId?: string }) {
  return (
    <Card as="section" padding="sm" className="mb-4" exclude={ideaId}>
      <details>
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-ink-dim hover:text-accent">
          Як читати ці статуси
        </summary>
        <div className="mt-3 space-y-4">
          <div>
            <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-dim">
              Вердикт критерію
            </p>
            <ul className="space-y-2">
              {TONE_ORDER.map((tone) => {
                const meta = TONE_META[tone];
                return (
                  <li key={tone} className="flex flex-wrap items-baseline gap-2">
                    <Pill label={meta.label} token={meta.token} />
                    <span className="text-sm text-ink-dim">{meta.hint}</span>
                  </li>
                );
              })}
              <li className="flex flex-wrap items-baseline gap-2">
                <Pill label={DISAGREEMENT_META.label} token={TONE_META.owner.token} />
                <span className="text-sm text-ink-dim">{DISAGREEMENT_META.hint}</span>
              </li>
            </ul>
          </div>

          <div>
            <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-ink-dim">
              Як зведено розбіжність (резолюція)
            </p>
            <ul className="space-y-2">
              {RESOLUTION_ORDER.map((resolution) => {
                const meta = RESOLUTION_META[resolution];
                return (
                  <li key={resolution} className="flex flex-wrap items-baseline gap-2">
                    <Pill label={meta.label} token={RESOLUTION_TOKEN[resolution]} />
                    <span className="text-sm text-ink-dim">{meta.hint}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </details>
    </Card>
  );
}
