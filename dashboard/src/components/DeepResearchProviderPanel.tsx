import Card from "@/components/Card";
import { VerdictRowDetails } from "@/components/VerdictDetails";
import type { ProviderGroup } from "@/lib/deep-research";

// Вміст однієї вкладки в DeepResearchTabs: усі критерії й d_-блоки, які
// оцінила саме ця модель. Server Component (Card сама розбирає посилання на
// ідеї), тому рендериться в page.tsx і передається в клієнтський DeepResearchTabs
// готовим деревом — Card не можна імпортувати у "use client"-файл.
export default async function DeepResearchProviderPanel({
  group,
  ideaId,
}: {
  group: ProviderGroup;
  ideaId?: string;
}) {
  return (
    <>
      {group.model && (
        <p className="mb-3 text-sm text-ink-dim">
          Дослідження виконала модель{" "}
          <span className="font-mono text-xs text-ink">{group.model}</span> — за нею можна
          порівнювати якість прогонів, зроблених у різний час.
        </p>
      )}
      <ul className="space-y-3">
      {group.items.map(({ key, title, row }, index) => (
        <Card as="li" key={key} index={index} padding="sm" exclude={ideaId}>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1">
            <span className="text-sm text-ink">{title}</span>
          </span>
          <VerdictRowDetails row={row} />
        </Card>
        ))}
      </ul>
    </>
  );
}
