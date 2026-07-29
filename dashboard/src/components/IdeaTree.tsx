import Link from "next/link";
import type { IdeaNode } from "@/lib/tree";
import { CONFIDENCE_META, REJECTION_META } from "@/lib/status";
import StatusBadge from "./StatusBadge";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("uk-UA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function IdeaRow({ node, depth }: { node: IdeaNode; depth: number }) {
  return (
    <Link
      href={`/ideas/${node.id}`}
      className={`group grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] items-center gap-x-4 gap-y-1 rounded-md px-3 py-2.5 transition-colors hover:bg-paper-raised ${
        node.dimmed ? "opacity-50" : ""
      }`}
      style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}
    >
      <span className="font-mono text-xs text-ink-dim">{node.id}</span>
      <span className="min-w-0 truncate font-medium text-ink group-hover:text-accent">
        {node.title}
      </span>
      <StatusBadge status={node.status} />
      <span className="hidden text-xs text-ink-dim sm:block">
        {node.rejection_code ? REJECTION_META[node.rejection_code] : ""}
      </span>
      <span className="hidden text-xs text-ink-dim md:block">
        {node.confidence ? CONFIDENCE_META[node.confidence].label : ""}
      </span>
      <span className="hidden font-mono text-xs text-ink-dim lg:block">
        {node.claimed_revenue ?? ""}
      </span>
      <span className="hidden font-mono text-xs text-ink-dim xl:block">
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
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto] gap-x-4 px-3 pb-2 pl-3 font-mono text-[11px] uppercase tracking-wide text-ink-dim">
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

export { formatDate };
