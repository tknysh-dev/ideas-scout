"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { EASE } from "@/components/motion";

interface DeepResearchTab {
  provider: string;
  count: number;
  panel: ReactNode;
}

// Локальний стейт замість Tabs.tsx (той працює через href/навігацію): панелі
// вже відрендерені на сервері (Card усередині них сама розбирає посилання на
// ідеї), тож перемикання — це просто показ/приховання готового дерева без
// звернення до сервера.
export default function DeepResearchTabs({ tabs }: { tabs: DeepResearchTab[] }) {
  const baseId = useId();
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (tabs.length === 0) return null;

  const move = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Внесок кожної моделі-дослідника" className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((tab, index) => {
          const isActive = index === active;
          const tabId = `${baseId}-tab-${index}`;
          const panelId = `${baseId}-panel-${index}`;
          return (
            <button
              key={tab.provider}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={tabId}
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  move(index, 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  move(index, -1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  move(-1, 1);
                } else if (event.key === "End") {
                  event.preventDefault();
                  move(0, -1);
                }
              }}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "text-ink" : "text-ink-dim hover:text-ink"
              }`}
            >
              {tab.provider}
              <span className="ml-2 font-mono text-xs text-ink-dim">{tab.count}</span>
              {isActive && (
                <motion.span
                  layoutId="deep-research-tab-underline"
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"
                  transition={{ duration: 0.25, ease: EASE }}
                />
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab, index) => (
        <div
          key={tab.provider}
          role="tabpanel"
          id={`${baseId}-panel-${index}`}
          aria-labelledby={`${baseId}-tab-${index}`}
          hidden={index !== active}
          className="mt-4"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
