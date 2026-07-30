"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Prose from "@/components/Prose";
import { ARCH_DIAGRAMS, ARCH_NODES } from "@/lib/architecture";
import { loadArchDoc, type ArchDocResult } from "@/lib/actions/architecture";
import { formatDateTime } from "@/lib/dates";

// Mermaid не має доступу до наших CSS-змінних, тому палітру передаємо явно —
// інакше діаграма лишається світлою в темній темі.
function themeVariables() {
  const style = getComputedStyle(document.body);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: v("--paper"),
    primaryColor: v("--paper-raised"),
    primaryTextColor: v("--ink"),
    primaryBorderColor: v("--line-strong"),
    secondaryColor: v("--paper"),
    tertiaryColor: v("--paper"),
    lineColor: v("--line-strong"),
    textColor: v("--ink"),
    clusterBkg: "transparent",
    clusterBorder: v("--line"),
    nodeBorder: v("--line-strong"),
    mainBkg: v("--paper-raised"),
    edgeLabelBackground: v("--paper"),
    fontFamily: style.fontFamily,
    fontSize: "14px",
  };
}

// Mermaid ставить вузлам id виду `<id svg>-flowchart-<ключ>-<n>`. Суфікс `__cfg`
// відрізаємо — це той самий блок на другій діаграмі, лише під іншим id.
function nodeKeyOf(el: Element): string | null {
  const raw = /flowchart-(.+?)-\d+$/.exec(el.id ?? "")?.[1] ?? "";
  const key = raw.split("__")[0];
  return key in ARCH_NODES ? key : null;
}

function DiagramCanvas({
  id,
  source,
  onOpen,
}: {
  id: string;
  source: string;
  onOpen: (key: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const draw = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: themeVariables(),
      flowchart: { htmlLabels: true, curve: "basis", padding: 12 },
    });
    const { svg } = await mermaid.render(`arch-svg-${id}`, source);
    container.innerHTML = svg;
    // Натуральна ширина як стеля: вужчу діаграму не розтягуємо на всю колонку
    // (інакше підписи роз'їжджаються), ширшу — вписуємо пропорційно.
    const el = container.querySelector("svg");
    if (el) {
      el.style.width = `${el.viewBox.baseVal.width}px`;
      el.style.maxWidth = "100%";
      el.style.height = "auto";
    }
    for (const node of container.querySelectorAll("g.node")) {
      if (!nodeKeyOf(node)) continue;
      (node as SVGGElement).style.cursor = "pointer";
      node.setAttribute("tabindex", "0");
      node.setAttribute("role", "button");
    }
  }, [id, source]);

  useEffect(() => {
    const onFail = (err: unknown) =>
      setError(err instanceof Error ? err.message : "Невідома помилка");
    draw().catch(onFail);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => draw().catch(onFail);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [draw]);

  const openFromEvent = (target: EventTarget | null) => {
    const node = (target as Element | null)?.closest?.("g.node");
    const key = node ? nodeKeyOf(node) : null;
    if (key) onOpen(key);
  };

  return (
    <>
      <div
        ref={containerRef}
        onClick={(e) => openFromEvent(e.target)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openFromEvent(e.target);
          }
        }}
        className="overflow-x-auto rounded-lg border border-line bg-paper-raised p-6 [&_svg]:mx-auto"
      />
      {error && (
        <p className="mt-2 text-sm text-ink-dim">Не вдалося намалювати діаграму: {error}</p>
      )}
    </>
  );
}

export default function ArchitectureDiagram() {
  const [active, setActive] = useState<string | null>(null);
  const [doc, setDoc] = useState<ArchDocResult | null>(null);

  useEffect(() => {
    if (!active) return;
    let stale = false;
    void loadArchDoc(active).then((result) => {
      if (!stale) setDoc(result);
    });
    return () => {
      stale = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const open = (key: string) => {
    setDoc(null);
    setActive(key);
  };

  const node = active ? ARCH_NODES[active] : null;

  return (
    <>
      <div className="space-y-10">
        {ARCH_DIAGRAMS.map((diagram) => (
          <section key={diagram.id}>
            <h2 className="font-display text-xl text-ink">{diagram.title}</h2>
            <p className="mb-3 mt-1 max-w-3xl text-sm text-ink-dim">{diagram.caption}</p>
            <DiagramCanvas id={diagram.id} source={diagram.source} onOpen={open} />
          </section>
        ))}
      </div>

      {node && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
          onClick={() => setActive(null)}
          role="dialog"
          aria-modal="true"
          aria-label={node.title}
        >
          <div
            className="my-auto w-full max-w-3xl rounded-lg border border-line bg-paper-raised shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
              <div>
                <h2 className="font-display text-xl text-ink">{node.title}</h2>
                {(node.doc || node.ref) && (
                  <p className="mt-1 font-mono text-xs text-ink-dim">
                    {node.doc ?? node.ref}
                    {node.doc && doc?.changed && ` · змінено ${formatDateTime(doc.changed)}`}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
              >
                Закрити
              </button>
            </header>

            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
              <Prose content={node.summary} />

              {node.doc && (
                <div className="mt-6 border-t border-line pt-5">
                  {doc === null ? (
                    <p className="text-sm text-ink-dim">Читаю файл…</p>
                  ) : doc.error ? (
                    <p className="text-sm text-ink-dim">
                      Не вдалося прочитати {node.doc}: {doc.error}
                    </p>
                  ) : doc.content && node.doc.endsWith(".md") ? (
                    <Prose content={doc.content} />
                  ) : (
                    <pre className="overflow-x-auto text-xs text-ink">{doc.content}</pre>
                  )}
                </div>
              )}
            </div>

            {node.doc && (
              <footer className="border-t border-line px-6 py-3">
                <Link
                  href={`/config/${node.doc}`}
                  className="font-mono text-xs text-ink-dim hover:text-accent"
                >
                  Відкрити окремою сторінкою →
                </Link>
              </footer>
            )}
          </div>
        </div>
      )}
    </>
  );
}
