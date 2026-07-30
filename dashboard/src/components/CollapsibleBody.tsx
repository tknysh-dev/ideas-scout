"use client";

import { useEffect, useRef, useState } from "react";

const COLLAPSED_PX = 84;

// Розбір критерія буває на кілька абзаців — у згорнутому вигляді картка займає
// фіксовану висоту, щоб увесь чек-лист читався одним поглядом.
export default function CollapsibleBody({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const node = inner.current;
    if (!node) return;

    const measure = () => setOverflows(node.scrollHeight > COLLAPSED_PX + 8);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const clamped = overflows && !expanded;

  return (
    <div>
      <div
        className="relative overflow-hidden"
        style={{ maxHeight: clamped ? COLLAPSED_PX : undefined }}
      >
        <div
          ref={inner}
          className="[&>.prose-doc>*:first-child]:mt-0 [&>.prose-doc>*:last-child]:mb-0"
        >
          {children}
        </div>
        {clamped && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-[color:var(--paper-raised)]" />
        )}
      </div>

      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 font-mono text-[11px] uppercase tracking-wide text-ink-dim hover:text-accent"
        >
          {expanded ? "Згорнути" : "Показати повністю"}
        </button>
      )}
    </div>
  );
}
