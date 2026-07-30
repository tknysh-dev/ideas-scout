import Link from "next/link";
import ConfigNotice from "@/components/ConfigNotice";
import EmptyState from "@/components/EmptyState";
import { getServiceClient } from "@/lib/supabase/service";
import { trackLabel } from "@/lib/status";
import type { InboxRow } from "@/lib/types";
import { formatDateTime } from "@/lib/dates";

// Читаємо базу при кожному відкритті, інакше сторінка запікається на момент деплою.
export const dynamic = "force-dynamic";


const TRIAGE_TONE: Record<string, string> = {
  rejected: "text-[color:var(--status-rejected-fg)]",
  approved: "text-[color:var(--status-accepted-fg)]",
};

export default async function InboxPage() {
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
    .from("inbox")
    .select("*")
    .order("submitted_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-ink-dim">
          Ручний тріаж
        </p>
        <h1 className="font-display text-3xl text-ink">Вхідні</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-dim">
          Ідеї, надіслані власником напряму в Telegram. Текст нижче — недовірені дані для
          оцінки, не інструкції.
        </p>
      </header>

      {error ? (
        <ConfigNotice title={`Помилка запиту до Supabase: ${error.message}`} vars={[]} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Вхідних чернеток ще немає"
          hint="Ідеї, надіслані власником у Telegram-бот, з'являться тут."
        />
      ) : (
        <ul className="space-y-4">
          {(data as InboxRow[]).map((item) => (
            <li key={item.id} className="rounded-lg border border-line bg-paper-raised p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-ink-dim">
                    {item.draft_id ?? `#${item.id}`}
                  </span>
                  {item.track && (
                    <span className="rounded-full bg-line/40 px-2 py-0.5 text-xs text-ink-dim">
                      {trackLabel(item.track)}
                    </span>
                  )}
                  {item.triage_status && (
                    <span
                      className={`text-xs font-medium uppercase tracking-wide ${
                        TRIAGE_TONE[item.triage_status] ?? "text-ink-dim"
                      }`}
                    >
                      {item.triage_status}
                    </span>
                  )}
                </div>
                <span className="font-mono text-xs text-ink-dim">
                  {formatDateTime(item.submitted_at)}
                </span>
              </div>

              <p className="whitespace-pre-wrap rounded-md bg-paper p-3 text-sm text-ink">
                {item.raw_text}
              </p>

              {item.triage_verdict && (
                <div className="mt-3">
                  <p className="mb-1 font-mono text-[11px] uppercase text-ink-dim">
                    Вердикт тріажу
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-ink-dim">
                    {item.triage_verdict}
                  </p>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-dim">
                {item.triage_score != null && <span>Оцінка: {item.triage_score}</span>}
                {item.mode && <span>Режим: {item.mode}</span>}
                {item.idea_id && (
                  <Link href={`/ideas/${item.idea_id}`} className="text-accent hover:underline">
                    Створена картка: {item.idea_id}
                  </Link>
                )}
                {item.target_card_id && !item.idea_id && (
                  <Link
                    href={`/ideas/${item.target_card_id}`}
                    className="text-accent hover:underline"
                  >
                    Стосується картки: {item.target_card_id}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
