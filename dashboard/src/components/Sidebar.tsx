"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { EASE } from "@/components/motion";
import { logout } from "@/lib/actions/session";

// Крапка біля пункту меню, поки сторінка ще їде з сервера. Сама поява
// затримана в CSS, тож на швидкому переході її не видно.
function PendingDot() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`link-hint ${pending ? "is-pending" : ""}`} />;
}

const LINKS = [
  { href: "/", label: "Дошка", hint: "Дерево знахідок" },
  { href: "/decisions", label: "Рішення", hint: "Черга «Очікує рішення»" },
  { href: "/runs", label: "Прогони", hint: "Журнал джобів" },
  { href: "/inbox", label: "Вхідні", hint: "Ручні ідеї з Telegram" },
  { href: "/config", label: "Конфігурація", hint: "Промпти й критерії" },
  { href: "/architecture", label: "Архітектура", hint: "Як це все працює" },
];

export default function Sidebar({
  pendingDecisions = 0,
  authDisabled = false,
}: {
  pendingDecisions?: number;
  authDisabled?: boolean;
}) {
  const pathname = usePathname();

  if (pathname === "/login") return null;

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-paper-raised px-5 py-6">
      <div className="mb-8">
        <p className="font-display text-[1.35rem] leading-none tracking-tight text-ink">
          Ideas
          <br />
          Scout
        </p>
        <p className="mt-1.5 font-mono text-[11px] uppercase tracking-widest text-ink-dim">
          реєстр знахідок
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {LINKS.map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`group relative rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-accent/10 text-accent"
                  : "text-ink-dim hover:bg-line/40 hover:text-ink"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent"
                  transition={{ duration: 0.25, ease: EASE }}
                />
              )}
              <span className="flex items-center gap-2 font-medium">
                {link.label}
                {link.href === "/decisions" && pendingDecisions > 0 && (
                  <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-ink">
                    {pendingDecisions}
                  </span>
                )}
                <PendingDot />
              </span>
              <span className="block text-xs text-ink-dim/80 group-hover:text-ink-dim">
                {link.hint}
              </span>
            </Link>
          );
        })}
      </nav>

      {authDisabled ? (
        <p className="mt-4 rounded-md border border-dashed border-line-strong px-3 py-2 text-xs text-ink-dim">
          Авторизація вимкнена (dev)
        </p>
      ) : (
        <form action={logout} className="mt-4">
          <button
            type="submit"
            className="w-full rounded-md border border-line px-3 py-2 text-left text-xs font-medium text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
          >
            Вийти
          </button>
        </form>
      )}
    </aside>
  );
}
