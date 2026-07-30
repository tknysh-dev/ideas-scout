"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import StatusBadge from "@/components/StatusBadge";
import type { IdeaRef } from "@/lib/idea-refs";

const CLOSE_DELAY_MS = 160;

export default function IdeaRefPill({ idea }: { idea: IdeaRef }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const show = useCallback(() => {
    cancelClose();
    if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    setOpen(true);
  }, [cancelClose]);

  const hide = useCallback(() => {
    cancelClose();
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const reposition = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  return (
    <span
      ref={anchorRef}
      className="inline-block"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <Link
        href={`/ideas/${idea.id}`}
        className="inline-flex max-w-[20rem] items-baseline gap-1 rounded-md border border-line-strong bg-gradient-to-b from-paper-raised to-paper px-1.5 align-baseline text-[0.9em] leading-tight text-ink no-underline shadow-[0_1px_1px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.5)] hover:border-accent hover:text-accent dark:shadow-[0_1px_1px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.07)]"
      >
        <span className="shrink-0 whitespace-nowrap font-mono text-[0.85em] text-ink-dim">
          {idea.id}:
        </span>
        <span className="min-w-0 truncate">{idea.title}</span>
      </Link>
      {open && rect && <Tooltip idea={idea} rect={rect} onEnter={cancelClose} onLeave={hide} />}
    </span>
  );
}

function Tooltip({
  idea,
  rect,
  onEnter,
  onLeave,
}: {
  idea: IdeaRef;
  rect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const width = 340;
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
  const below = rect.bottom + 8;
  const openUpward = below + 200 > window.innerHeight && rect.top > 220;

  return createPortal(
    <div
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "fixed",
        left,
        width,
        ...(openUpward ? { bottom: window.innerHeight - rect.top + 8 } : { top: below }),
      }}
      className="z-50 rounded-lg border border-line bg-paper-raised p-4 shadow-lg shadow-black/10"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-dim">{idea.id}</span>
        <StatusBadge status={idea.status} />
        <a
          href={`/ideas/${idea.id}`}
          target="_blank"
          rel="noreferrer"
          title="Відкрити в новій вкладці"
          aria-label="Відкрити в новій вкладці"
          className="ml-auto rounded-md p-1 text-ink-dim hover:bg-paper hover:text-accent"
        >
          <ExternalLinkIcon />
        </a>
      </div>
      <p className="font-display text-base leading-snug text-ink">{idea.title}</p>
      {idea.summary && (
        <p className="mt-2 text-sm leading-relaxed text-ink-dim">{idea.summary}</p>
      )}
    </div>,
    document.body,
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 9.5V13a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 13V4.5A1.5 1.5 0 0 1 3 3h3.5" />
      <path d="M10 1.5h4.5V6M14.5 1.5 7.5 8.5" />
    </svg>
  );
}
