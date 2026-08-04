import Link from "next/link";
import { notFound } from "next/navigation";
import Card from "@/components/Card";
import CompetitorsSection from "@/components/CompetitorsSection";
import ConfigNotice from "@/components/ConfigNotice";
import CriteriaAnalysisSection from "@/components/CriteriaAnalysis";
import DecisionPanel from "@/components/DecisionPanel";
import DeepResearchBlocks from "@/components/DeepResearchBlocks";
import DeepResearchLegend from "@/components/DeepResearchLegend";
import DeepResearchProviderPanel from "@/components/DeepResearchProviderPanel";
import DeepResearchStatus, { type ActiveSynthesisJob } from "@/components/DeepResearchStatus";
import DeepResearchTabs from "@/components/DeepResearchTabs";
import IdeaOptionsMenu from "@/components/IdeaOptionsMenu";
import { Field, FieldGroup } from "@/components/FieldGroup";
import Prose from "@/components/Prose";
import StatusBadge from "@/components/StatusBadge";
import TypeBadge from "@/components/TypeBadge";
import { getServiceClient } from "@/lib/supabase/service";
import {
  AUTHOR_INTEREST_META,
  CONFIDENCE_META,
  OWNER_DECIDABLE_STATUSES,
  REJECTION_META,
  SIGNAL_TYPE_META,
  trackLabel,
} from "@/lib/status";
import { analyzeCriteria, splitCriteriaSection } from "@/lib/criteria";
import type { StructuredVerdict } from "@/lib/criteria";
import { groupByProvider, groupVerdicts, VERDICT_TONE } from "@/lib/deep-research";
import type { CompetitorRow, CriteriaVerdictRow, EventRow, Idea, SourceRow } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/dates";

// Сторінка показує хід синтезу і оновлюється сама, поки він іде, — запечений
// рендер показував би застиглий лоадер.
export const dynamic = "force-dynamic";

export default async function IdeaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = getServiceClient();

  if (!supabase) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
        <ConfigNotice
          title="Немає доступу до бази"
          vars={["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]}
        />
      </div>
    );
  }

  const [
    { data: idea },
    { data: sources },
    { data: events },
    { data: verdictRows },
    { data: competitorRows },
    { data: activeJobs },
  ] = await Promise.all([
    supabase.from("ideas").select("*").eq("id", id).maybeSingle(),
    supabase.from("sources").select("*").eq("idea_id", id).order("id"),
    supabase.from("events").select("*").eq("idea_id", id).order("happened_at"),
    supabase.from("criteria_verdicts").select("*").eq("idea_id", id).eq("stage", "deep"),
    supabase.from("competitors").select("*").eq("idea_id", id).order("created_at"),
    supabase
      .from("jobs")
      .select("status,created_at,run_id")
      .eq("type", "deep_research_synthesis")
      .filter("payload->>idea_id", "eq", id)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (!idea) notFound();

  const record = idea as Idea;
  let parent: { id: string; title: string } | null = null;
  if (record.parent_id) {
    const { data: parentData } = await supabase
      .from("ideas")
      .select("id,title")
      .eq("id", record.parent_id)
      .maybeSingle();
    parent = parentData;
  }

  const deep = groupVerdicts((verdictRows ?? []) as CriteriaVerdictRow[]);
  const providerGroups = groupByProvider((verdictRows ?? []) as CriteriaVerdictRow[], record.track);
  const competitors = (competitorRows ?? []) as CompetitorRow[];
  const activeJob = (activeJobs?.[0] ?? null) as ActiveSynthesisJob | null;

  // Після глибокого дослідження вердикт критерію існує як дані, тож розбір
  // прози лишається лише джерелом пояснювального тексту, а не вердикту.
  const structured = new Map<string, StructuredVerdict>();
  for (const [key, entry] of deep.byKey) {
    if (entry.synthesis) {
      structured.set(key, {
        tone: VERDICT_TONE[entry.synthesis.verdict],
        summary: entry.synthesis.summary,
      });
    }
  }

  const { section: criteriaSection, rest: bodyRest } = splitCriteriaSection(record.body);
  const criteria = analyzeCriteria(record, criteriaSection, structured);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="mb-6 flex items-center gap-2 font-mono text-xs text-ink-dim">
        <Link href="/" className="hover:text-accent">
          {trackLabel(record.track)}
        </Link>
        <span>/</span>
        {parent && (
          <>
            <Link href={`/ideas/${parent.id}`} className="hover:text-accent">
              {parent.title}
            </Link>
            <span>/</span>
          </>
        )}
        <span>{record.id}</span>
      </div>

      <Card as="section" plain className="mb-8" exclude={record.id}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={record.status} />
          <TypeBadge type={record.type} />
          {record.research_depth === "deep" && (
            <span
              title="Критерії перевірено кількома незалежними моделями, вердикт зведено синтезом"
              className="inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide"
              style={{
                color: "var(--research-btn-fg)",
                backgroundColor: "var(--research-btn-bg)",
              }}
            >
              Глибоке дослідження
            </span>
          )}
        </div>
        <h1 className="font-display text-3xl text-ink">{record.title}</h1>
        {record.mechanic_summary && (
          <p className="mt-2 max-w-2xl text-ink-dim">{record.mechanic_summary}</p>
        )}
        {OWNER_DECIDABLE_STATUSES.includes(record.status) && (
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <DecisionPanel ideaId={record.id} currentStatus={record.status} bare />
            <IdeaOptionsMenu ideaId={record.id} />
          </div>
        )}
      </Card>

      {activeJob && <DeepResearchStatus job={activeJob} />}

      <div className="grid gap-5">
        <FieldGroup title="Сигнал" index={0} exclude={record.id}>
          <Field label="Виявлено">{formatDate(record.discovered)}</Field>
          <Field label="Тип сигналу">{SIGNAL_TYPE_META[record.signal_type]}</Field>
          {record.monetization_hypothesis && (
            <Field label="Гіпотеза монетизації">{record.monetization_hypothesis}</Field>
          )}
          <Field label="Згадувань">{record.mentions_count}</Field>
          <Field label="Заявлений дохід">{record.claimed_revenue ?? "—"}</Field>
        </FieldGroup>

        <FieldGroup title="Вердикт" index={1} exclude={record.id}>
          {record.rejection_code && (
            <Field label="Код відмови">
              <span className="text-[color:var(--status-rejected-fg)]">
                {REJECTION_META[record.rejection_code]}
              </span>
            </Field>
          )}
          {record.rejection_detail && (
            <Field label="Деталі відмови">{record.rejection_detail}</Field>
          )}
          {record.rejection_codes_extra.length > 0 && (
            <Field label="Супутні коди">
              {record.rejection_codes_extra
                .map((code) => REJECTION_META[code as keyof typeof REJECTION_META] ?? code)
                .join(", ")}
            </Field>
          )}
          <Field label="Впевненість">
            {record.confidence ? CONFIDENCE_META[record.confidence].label : "—"}
          </Field>
          {record.missing_capabilities.length > 0 && (
            <Field label="Бракує можливостей">
              {record.missing_capabilities.join(", ")}
            </Field>
          )}
        </FieldGroup>

        <FieldGroup title="Стеля й зусилля" index={2} exclude={record.id}>
          <Field label="Очікувана стеля">{record.ceiling_estimate ?? "—"}</Field>
          <Field label="Годин на запуск">{record.launch_effort_hours ?? "—"}</Field>
          <Field label="Позначка">
            {record.ceiling_flag === "review" ? "Винесено на ручну оцінку" : "—"}
          </Field>
        </FieldGroup>

        <FieldGroup title="Повторний перегляд" index={3} exclude={record.id}>
          <Field label="Умова перегляду">{record.review_condition ?? "—"}</Field>
          <Field label="Скільки разів повертали">{record.review_count}</Field>
          <Field label="Останній перегляд">{formatDate(record.last_reviewed)}</Field>
          <Field label="Мін. інтервал">{record.min_review_interval_days} дн.</Field>
          {record.transferred_to && (
            <Field label="Перенесено в">
              <Link href={`/ideas/${record.transferred_to}`} className="text-accent hover:underline">
                {record.transferred_to}
              </Link>
            </Field>
          )}
        </FieldGroup>

        <FieldGroup title="Провенанс вердикту" index={4} exclude={record.id}>
          <Field label="Провайдер">{record.verdict_provider ?? "—"}</Field>
          <Field label="Модель">{record.verdict_model ?? "—"}</Field>
          <Field label="Run ID">
            {record.verdict_run_id ? (
              <Link href="/runs" className="font-mono text-xs text-accent hover:underline">
                {record.verdict_run_id}
              </Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Версія критеріїв">{record.criteria_version ?? "—"}</Field>
          <Field label="Глибина дослідження">
            {record.research_depth === "deep"
              ? `Глибоке — перевірено незалежно${
                  deep.providers.length > 0 ? ` (${deep.providers.join(", ")})` : ""
                }`
              : "Початкове — одна модель"}
          </Field>
          {record.deep_researched_at && (
            <Field label="Глибоке дослідження">
              {formatDateTime(record.deep_researched_at)}
            </Field>
          )}
        </FieldGroup>
      </div>

      {deep.byKey.size > 0 && <DeepResearchLegend ideaId={record.id} />}

      {criteria && (
        <CriteriaAnalysisSection
          analysis={criteria}
          ideaId={record.id}
          verdicts={deep.byKey.size > 0 ? deep.byKey : undefined}
        />
      )}

      {deep.byKey.size > 0 && <DeepResearchBlocks data={deep} ideaId={record.id} />}

      {providerGroups.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
            Глибоке дослідження: за моделями
          </h2>
          <p className="mb-3 text-sm text-ink-dim">
            Консолідований розбір вище лишається головним. Тут — що саме принесла кожна
            модель-дослідник: її вердикти, оцінки, пояснення й докази по всіх критеріях і
            додаткових блоках.
          </p>
          <DeepResearchTabs
            tabs={providerGroups.map((group) => ({
              provider: group.provider,
              count: group.items.length,
              panel: <DeepResearchProviderPanel group={group} ideaId={record.id} />,
            }))}
          />
        </section>
      )}

      {competitors.length > 0 && (
        <CompetitorsSection competitors={competitors} ideaId={record.id} />
      )}

      {bodyRest && (
        <section className="mt-8">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
            Опис
          </h2>
          <Card padding="lg" exclude={record.id}>
            <Prose content={bodyRest} />
          </Card>
        </section>
      )}

      {sources && sources.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
            Джерела
          </h2>
          <ul className="space-y-3">
            {(sources as SourceRow[]).map((source, index) => (
              <Card
                as="li"
                key={source.id}
                index={index}
                padding="sm"
                exclude={record.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-sm text-accent hover:underline"
                  >
                    {source.url}
                  </a>
                  <span className="font-mono text-xs text-ink-dim">
                    {formatDate(source.published_date)}
                  </span>
                </div>
                {source.quote && (
                  <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm italic text-ink-dim">
                    “{source.quote}”
                  </blockquote>
                )}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-dim">
                  {source.author_interest && (
                    <span>Зацікавленість: {AUTHOR_INTEREST_META[source.author_interest]}</span>
                  )}
                  <span>Незалежних підтверджень: {source.independent_confirmations}</span>
                  {source.origin && <span>Походження: {source.origin}</span>}
                </div>
              </Card>
            ))}
          </ul>
        </section>
      )}

      {events && events.length > 0 && (
        <section className="mt-8 mb-4">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
            Хронологія подій
          </h2>
          <ol className="relative space-y-5 border-l border-line pl-5">
            {(events as EventRow[]).map((event, index) => (
              <Card as="li" key={event.id} index={index} plain exclude={record.id} className="relative">
                <span className="absolute -left-[1.45rem] top-1 h-2 w-2 rounded-full bg-accent" />
                <p className="font-mono text-xs text-ink-dim">
                  {formatDateTime(event.happened_at)} · {event.actor}
                </p>
                <p className="text-sm text-ink">{event.change}</p>
                {event.reason && <p className="text-sm text-ink-dim">{event.reason}</p>}
              </Card>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
