"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { EASE } from "@/components/motion";

export interface TabItem {
  value: string;
  label: string;
  href: string;
  count?: number;
}

// Підкреслення їде між табами одним елементом (layoutId), а не з'являється
// заново під кожним — так око стежить за переходом, а не за спалахом.
export default function Tabs({
  items,
  active,
  layoutId = "tab-underline",
}: {
  items: TabItem[];
  active: string;
  layoutId?: string;
}) {
  return (
    <div className="flex gap-1 border-b border-line">
      {items.map((item) => {
        const isActive = item.value === active;
        return (
          <Link
            key={item.value}
            href={item.href}
            scroll={false}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive ? "text-ink" : "text-ink-dim hover:text-ink"
            }`}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="ml-2 font-mono text-xs text-ink-dim">{item.count}</span>
            )}
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent"
                transition={{ duration: 0.25, ease: EASE }}
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}
