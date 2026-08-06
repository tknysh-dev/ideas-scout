import "server-only";
import { cache } from "react";
import { getServiceClient } from "@/lib/supabase/service";
import { createIdeaIdPattern, type IdeaRef } from "@/lib/idea-refs";

// Довідник тягнемо цілком і один раз на рендер: id ідей розкидані по всіх
// текстах усіх карток сторінки, тож окремий запит на картку дав би десятки
// запитів заради таблиці на кілька сотень рядків.
const loadRegistry = cache(async (): Promise<Map<string, IdeaRef>> => {
  const registry = new Map<string, IdeaRef>();
  const supabase = getServiceClient();
  if (!supabase) return registry;

  const { data } = await supabase.from("ideas").select("id,title,status,mechanic_summary");
  for (const row of data ?? []) {
    registry.set(row.id, {
      id: row.id,
      title: row.title,
      status: row.status,
      summary: row.mechanic_summary,
    });
  }
  return registry;
});

// Повертає лише ті id, які справді згадані в переданих текстах і існують у
// реєстрі: неіснуючий id лишається звичайним текстом, а не битим посиланням.
export async function resolveIdeaRefs(
  texts: string[],
  exclude?: string,
): Promise<Record<string, IdeaRef>> {
  const mentioned = new Set<string>();
  for (const text of texts) {
    for (const match of text.match(createIdeaIdPattern()) ?? []) mentioned.add(match);
  }
  if (exclude) mentioned.delete(exclude);
  if (mentioned.size === 0) return {};

  const registry = await loadRegistry();
  const refs: Record<string, IdeaRef> = {};
  for (const id of mentioned) {
    const ref = registry.get(id);
    if (ref) refs[id] = ref;
  }
  return refs;
}
