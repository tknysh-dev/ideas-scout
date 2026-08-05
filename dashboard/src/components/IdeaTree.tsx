import Link from "next/link";
import type { IdeaNode } from "@/lib/tree";
import { CONFIDENCE_META, REJECTION_META } from "@/lib/status";
import StatusBadge from "./StatusBadge";
import { formatDate } from "@/lib/dates";


// Однакова кількість треків на кожному брейкпоінті, скільки клітинок реально
// видно (hidden sm:block і т.д. нижче) — інакше "auto"-колонки з довгим текстом
// (claimed_revenue) розтягуються і зжимають назву (1fr, min-w-0) аж до 0px.
// Вільну ширину ділять три колонки з довільним текстом — назва, код відмови і
// заявлений дохід (2fr:1fr:1fr); нижня межа кожної дорівнює її колишній фіксованій
// ширині, тому на вузьких екранах розкладка не змінилась. Решта — фіксовані:
// їхній вміст короткий і передбачуваний, а «auto» від довгого claimed_revenue
// зжимало б назву (min-w-0) аж до 0px.
const GRID =
  "grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_minmax(0,6.5rem)] " +
  "sm:grid-cols-[minmax(0,5.5rem)_minmax(0,2fr)_minmax(0,6.5rem)_minmax(9rem,1fr)] " +
  "md:grid-cols-[minmax(0,5.5rem)_minmax(0,2fr)_minmax(0,6.5rem)_minmax(9rem,1fr)_minmax(0,6rem)] " +
  "lg:grid-cols-[minmax(0,5.5rem)_minmax(0,2fr)_minmax(0,6.5rem)_minmax(9rem,1fr)_minmax(0,6rem)_minmax(8rem,1fr)] " +
  "xl:grid-cols-[minmax(0,5.5rem)_minmax(0,2fr)_minmax(0,6.5rem)_minmax(9rem,1fr)_minmax(0,6rem)_minmax(8rem,1fr)_minmax(0,7rem)]";

function IdeaRow({ node, depth }: { node: IdeaNode; depth: number }) {
  const rejectionLabel = node.rejection_code ? REJECTION_META[node.rejection_code] : "";
  const confidenceLabel = node.confidence ? CONFIDENCE_META[node.confidence].label : "";
  const revenueLabel = node.claimed_revenue ?? "";

  return (
    <Link
      href={`/ideas/${node.id}`}
      className={`group ${GRID} items-center gap-x-4 gap-y-1 rounded-md px-3 py-2.5 transition-colors hover:bg-paper-raised ${
        node.dimmed ? "opacity-50" : ""
      }`}
      style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}
    >
      <span className="truncate font-mono text-xs text-ink-dim" title={node.id}>
        {node.id}
      </span>
      <span
        className="line-clamp-2 min-w-0 font-medium text-ink group-hover:text-accent"
        title={node.title}
      >
        {node.title}
      </span>
      <StatusBadge status={node.status} />
      <span
        className="hidden truncate text-xs text-ink-dim sm:block"
        title={rejectionLabel || undefined}
      >
        {rejectionLabel}
      </span>
      <span className="hidden truncate text-xs text-ink-dim md:block">{confidenceLabel}</span>
      <span
        className="hidden truncate font-mono text-xs text-ink-dim lg:block"
        title={revenueLabel || undefined}
      >
        {revenueLabel}
      </span>
      <span className="hidden truncate font-mono text-xs text-ink-dim xl:block">
        {formatDate(node.discovered)}
      </span>
    </Link>
  );
}

function TreeBranch({ node, depth }: { node: IdeaNode; depth: number }) {
  return (
    <div>
      <IdeaRow node={node} depth={depth} />
      {node.children.length > 0 && (
        <div className="border-l border-line" style={{ marginLeft: `${1.5 + depth * 1.5}rem` }}>
          {node.children.map((child) => (
            <TreeBranch key={child.id} node={child} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function IdeaTree({ nodes }: { nodes: IdeaNode[] }) {
  return (
    <div>
      <div
        className={`${GRID} gap-x-4 px-3 pb-2 pl-3 font-mono text-[11px] uppercase tracking-wide text-ink-dim`}
      >
        <span>ID</span>
        <span>Назва</span>
        <span>Статус</span>
        <span className="hidden sm:block">Код відмови</span>
        <span className="hidden md:block">Впевненість</span>
        <span className="hidden lg:block">Заявлений дохід</span>
        <span className="hidden xl:block">Виявлено</span>
      </div>
      <div className="divide-y divide-line/60">
        {nodes.map((node) => (
          <TreeBranch key={node.id} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}
