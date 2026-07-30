import Link from "next/link";
import { notFound } from "next/navigation";
import ConfigNotice from "@/components/ConfigNotice";
import DecisionPanel from "@/components/DecisionPanel";
import { Field, FieldGroup } from "@/components/FieldGroup";
import Prose from "@/components/Prose";
import StatusBadge from "@/components/StatusBadge";
import { getServiceClient } from "@/lib/supabase/service";
import {
  AUTHOR_INTEREST_META,
  CONFIDENCE_META,
  IDEA_TYPE_META,
  OWNER_DECIDABLE_STATUSES,
  REJECTION_META,
  SIGNAL_TYPE_META,
  trackLabel,
} from "@/lib/status";
import type { EventRow, Idea, SourceRow } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/dates";



export default async function IdeaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const [{ data: idea }, { data: sources }, { data: events }, { data: children }] =
    await Promise.all([
      supabase.from("ideas").select("*").eq("id", id).maybeSingle(),
      supabase.from("sources").select("*").eq("idea_id", id).order("id"),
      supabase.from("events").select("*").eq("idea_id", id).order("happened_at"),
      supabase.from("ideas").select("id,title,status").eq("parent_id", id),
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

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
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

      <header className="mb-8">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <StatusBadge status={record.status} />
          <span className="font-mono text-xs text-ink-dim">
            {IDEA_TYPE_META[record.type]}
          </span>
        </div>
        <h1 className="font-display text-3xl text-ink">{record.title}</h1>
        {record.mechanic_summary && (
          <p className="mt-2 max-w-2xl text-ink-dim">{record.mechanic_summary}</p>
        )}
      </header>

      {children && children.length > 0 && (
        <div className="mb-8 rounded-lg border border-line bg-paper-raised p-5">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
            Ніші цієї механіки
          </h2>
          <ul className="flex flex-wrap gap-2">
            {children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/ideas/${child.id}`}
                  className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent"
                >
                  <span className="font-mono text-xs text-ink-dim">{child.id}</span>
                  {child.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <FieldGroup title="Сигнал">
          <Field label="Виявлено">{formatDate(record.discovered)}</Field>
          <Field label="Тип сигналу">{SIGNAL_TYPE_META[record.signal_type]}</Field>
          {record.monetization_hypothesis && (
            <Field label="Гіпотеза монетизації">{record.monetization_hypothesis}</Field>
          )}
          <Field label="Згадувань">{record.mentions_count}</Field>
          <Field label="Заявлений дохід">{record.claimed_revenue ?? "—"}</Field>
        </FieldGroup>

        <FieldGroup title="Вердикт">
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

        <FieldGroup title="Стеля й зусилля">
          <Field label="Очікувана стеля">{record.ceiling_estimate ?? "—"}</Field>
          <Field label="Годин на запуск">{record.launch_effort_hours ?? "—"}</Field>
          <Field label="Позначка">
            {record.ceiling_flag === "review" ? "Винесено на ручну оцінку" : "—"}
          </Field>
        </FieldGroup>

        <FieldGroup title="Повторний перегляд">
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

        <FieldGroup title="Провенанс вердикту">
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
        </FieldGroup>
      </div>

      {OWNER_DECIDABLE_STATUSES.includes(record.status) && (
        <section className="mt-8">
          <DecisionPanel ideaId={record.id} currentStatus={record.status} />
        </section>
      )}

      {record.body && (
        <section className="mt-8">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
            Опис
          </h2>
          <div className="rounded-lg border border-line bg-paper-raised p-6">
            <Prose content={record.body} />
          </div>
        </section>
      )}

      {sources && sources.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
            Джерела
          </h2>
          <ul className="space-y-3">
            {(sources as SourceRow[]).map((source) => (
              <li key={source.id} className="rounded-lg border border-line bg-paper-raised p-4">
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
              </li>
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
            {(events as EventRow[]).map((event) => (
              <li key={event.id} className="relative">
                <span className="absolute -left-[1.45rem] top-1 h-2 w-2 rounded-full bg-accent" />
                <p className="font-mono text-xs text-ink-dim">
                  {formatDateTime(event.happened_at)} · {event.actor}
                </p>
                <p className="text-sm text-ink">{event.change}</p>
                {event.reason && <p className="text-sm text-ink-dim">{event.reason}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
