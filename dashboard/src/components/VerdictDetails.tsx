import CollapsibleBody from "@/components/CollapsibleBody";
import Prose from "@/components/Prose";
import { formatDate } from "@/lib/dates";
import {
  RESOLUTION_META,
  RESOLUTION_TOKEN,
  TONE_META,
  VERDICT_TONE,
  parseEvidence,
  type CriterionVerdicts,
} from "@/lib/deep-research";

export function Pill({
  label,
  token,
  title,
}: {
  label: string;
  token: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide"
      style={{
        color: `var(--status-${token}-fg)`,
        backgroundColor: `var(--status-${token}-bg)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `var(--status-${token}-fg)` }} />
      {label}
    </span>
  );
}

// Спільний під-блок «як моделі проголосували» — використовується і в базових
// критеріях (CriteriaAnalysis), і в d_-блоках (DeepResearchBlocks).
export default function VerdictDetails({ entry }: { entry: CriterionVerdicts }) {
  const { synthesis, models } = entry;
  if (!synthesis && models.length === 0) return null;

  const disagreement = new Set(models.map((row) => row.verdict)).size > 1;
  const evidence = parseEvidence(synthesis?.evidence);

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {models.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {models.map((row) => {
            const meta = TONE_META[VERDICT_TONE[row.verdict]];
            return <Pill key={row.provider} label={`${row.provider}: ${meta.label}`} token={meta.token} />;
          })}
          {disagreement && <Pill label="моделі розійшлись" token={TONE_META.owner.token} />}
        </div>
      )}

      {synthesis?.resolution && (
        <Pill
          label={RESOLUTION_META[synthesis.resolution].label}
          token={RESOLUTION_TOKEN[synthesis.resolution]}
          title={RESOLUTION_META[synthesis.resolution].hint}
        />
      )}

      {synthesis?.score && (
        <span className="ml-1 inline-block rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
          {synthesis.score}
        </span>
      )}

      {synthesis?.detail && (
        <CollapsibleBody>
          <Prose content={synthesis.detail} />
        </CollapsibleBody>
      )}

      {evidence.length > 0 && (
        <ul className="space-y-2">
          {evidence.map((item, index) => (
            <li key={index} className="text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-sm text-accent hover:underline"
                >
                  {item.url}
                </a>
                {item.published_date && (
                  <span className="font-mono text-xs text-ink-dim">{formatDate(item.published_date)}</span>
                )}
              </div>
              {item.quote && (
                <blockquote className="mt-1 border-l-2 border-line-strong pl-3 text-sm italic text-ink-dim">
                  “{item.quote}”
                </blockquote>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
