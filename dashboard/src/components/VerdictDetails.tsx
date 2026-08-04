import CollapsibleBody from "@/components/CollapsibleBody";
import Pill from "@/components/Pill";
import Prose from "@/components/Prose";
import { formatDate } from "@/lib/dates";
import {
  DISAGREEMENT_META,
  RESOLUTION_META,
  RESOLUTION_TOKEN,
  TONE_META,
  VERDICT_TONE,
  parseEvidence,
  type CriterionVerdicts,
  type EvidenceItem,
} from "@/lib/deep-research";
import type { CriteriaVerdictRow } from "@/lib/types";

export { default as Pill } from "@/components/Pill";

// Список доказів (лінк + дата + цитата) — спільна розмітка для синтезу
// (VerdictDetails) і для окремого рядка моделі (VerdictRowDetails).
function EvidenceList({ evidence }: { evidence: EvidenceItem[] }) {
  if (evidence.length === 0) return null;
  return (
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
  );
}

// Вердикт, оцінка, деталі й докази одного рядка моделі (вкладка провайдера в
// DeepResearchTabs) — та сама розмітка, що в VerdictDetails, але без
// синтезу: тут усі поля беруться з самого рядка моделі, а не з synthesis.
export function VerdictRowDetails({ row }: { row: CriteriaVerdictRow }) {
  const meta = TONE_META[VERDICT_TONE[row.verdict]];
  const evidence = parseEvidence(row.evidence);

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Pill label={meta.label} token={meta.token} />
        {row.score && (
          <span className="text-xs text-ink-dim">
            Оцінка:{" "}
            <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
              {row.score}
            </span>
          </span>
        )}
      </div>

      {row.summary && <p className="text-sm text-ink-dim first-letter:uppercase">{row.summary}</p>}

      {row.detail && (
        <CollapsibleBody>
          <Prose content={row.detail} />
        </CollapsibleBody>
      )}

      <EvidenceList evidence={evidence} />
    </div>
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
          {disagreement && <Pill label={DISAGREEMENT_META.label} token={TONE_META.owner.token} />}
        </div>
      )}

      {synthesis?.resolution && (
        <div className="space-y-1">
          <Pill label={RESOLUTION_META[synthesis.resolution].label} token={RESOLUTION_TOKEN[synthesis.resolution]} />
          <p className="text-xs text-ink-dim">{RESOLUTION_META[synthesis.resolution].hint}</p>
        </div>
      )}

      {synthesis?.score && (
        <p className="text-xs text-ink-dim">
          Оцінка:{" "}
          <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
            {synthesis.score}
          </span>
        </p>
      )}

      {synthesis?.detail && (
        <CollapsibleBody>
          <Prose content={synthesis.detail} />
        </CollapsibleBody>
      )}

      <EvidenceList evidence={evidence} />
    </div>
  );
}
