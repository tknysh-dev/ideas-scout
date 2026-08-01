"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "@/components/motion";

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
      {/* height: "auto" в motion міряється сама — власна висота вмісту тут
          невідома наперед і змінюється разом із шириною колонки. */}
      <motion.div
        className="relative overflow-hidden"
        animate={{ height: clamped ? COLLAPSED_PX : "auto" }}
        initial={false}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <div
          ref={inner}
          className="[&>.prose-doc>*:first-child]:mt-0 [&>.prose-doc>*:last-child]:mb-0"
        >
          {children}
        </div>
        <AnimatePresence>
          {clamped && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-[color:var(--paper-raised)]"
            />
          )}
        </AnimatePresence>
      </motion.div>

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
