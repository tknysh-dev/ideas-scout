import type { Idea } from "./types";

export interface IdeaNode extends Idea {
  children: IdeaNode[];
  dimmed: boolean;
}

/**
 * Будує дворівневе дерево (механіка -> ніші) з плаского списку.
 * Якщо активний фільтр статусу, батько без власного збігу все одно
 * лишається видимим (dimmed=true) — інакше зникає контекст для ніш, що збіглись.
 */
export function buildIdeaTree(
  ideas: Idea[],
  matches: (idea: Idea) => boolean,
  sortDir: "asc" | "desc",
): IdeaNode[] {
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));

  // Вузол належить циклу parent_id (включно з self-parent), якщо підйом по
  // ланцюжку батьків повертається до вже відвіданого вузла, не діставшись
  // жодного справжнього кореня чи сироти. Без цієї перевірки жоден вузол
  // циклу не задовольнив би умову "корінь" і весь цикл мовчки зникав би з
  // дерева — на відміну від сироти з битим parent_id, яка й так стає коренем.
  function isInCycle(id: string): boolean {
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      const parentId: string | null | undefined = byId.get(current)?.parent_id;
      if (!parentId || !byId.has(parentId)) return false;
      current = parentId;
    }
    return false;
  }

  const cycleIds = new Set(ideas.filter((idea) => isInCycle(idea.id)).map((idea) => idea.id));

  const childrenOf = new Map<string, Idea[]>();

  for (const idea of ideas) {
    if (idea.parent_id && byId.has(idea.parent_id) && !cycleIds.has(idea.id)) {
      const list = childrenOf.get(idea.parent_id) ?? [];
      list.push(idea);
      childrenOf.set(idea.parent_id, list);
    }
  }

  const sortByDate = (a: Idea, b: Idea) =>
    sortDir === "asc"
      ? a.discovered.localeCompare(b.discovered)
      : b.discovered.localeCompare(a.discovered);

  const roots = ideas.filter(
    (idea) => !idea.parent_id || !byId.has(idea.parent_id) || cycleIds.has(idea.id),
  );

  const nodes: IdeaNode[] = [];
  for (const root of roots.sort(sortByDate)) {
    const children = (childrenOf.get(root.id) ?? [])
      .filter(matches)
      .sort(sortByDate)
      .map((child) => ({ ...child, children: [], dimmed: false }));

    const rootMatches = matches(root);
    if (!rootMatches && children.length === 0) continue;

    nodes.push({ ...root, children, dimmed: !rootMatches });
  }

  return nodes;
}
