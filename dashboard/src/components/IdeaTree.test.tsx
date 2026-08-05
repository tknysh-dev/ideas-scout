import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import IdeaTree from "./IdeaTree";
import type { IdeaNode } from "@/lib/tree";
import type { Idea } from "@/lib/types";

function makeNode(overrides: Partial<IdeaNode> & { id: string }): IdeaNode {
  const base: Idea = {
    id: overrides.id,
    track: "passive-income",
    parent_id: null,
    title: `Ідея ${overrides.id}`,
    type: "mechanic",
    discovered: "2026-01-01T00:00:00.000Z",
    signal_type: "income_claim",
    monetization_hypothesis: null,
    mentions_count: 1,
    claimed_revenue: null,
    mechanic_summary: null,
    status: "new",
    rejection_code: null,
    rejection_detail: null,
    rejection_codes_extra: [],
    missing_capabilities: [],
    ceiling_estimate: null,
    launch_effort_hours: null,
    ceiling_flag: null,
    review_condition: null,
    review_count: 0,
    last_reviewed: null,
    min_review_interval_days: 0,
    confidence: null,
    transferred_to: null,
    verdict_provider: null,
    verdict_model: null,
    verdict_run_id: null,
    research_depth: "initial",
    deep_researched_at: null,
    deep_research_run_id: null,
    schema_version: 1,
    criteria_version: null,
    body: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  return { ...base, ...overrides, children: overrides.children ?? [], dimmed: overrides.dimmed ?? false };
}

describe("IdeaTree", () => {
  test("рендерить рядок для кожного вузла й дочірні під ним", () => {
    const nodes = [
      makeNode({
        id: "root-1",
        title: "Коренева ідея",
        children: [makeNode({ id: "child-1", title: "Дочірня ідея" })],
      }),
    ];
    render(<IdeaTree nodes={nodes} />);
    expect(screen.getByText("Коренева ідея")).toBeDefined();
    expect(screen.getByText("Дочірня ідея")).toBeDefined();
  });

  test("притлумлений вузол (dimmed) отримує клас прозорості", () => {
    const nodes = [makeNode({ id: "dim-1", title: "Притлумлена ідея", dimmed: true })];
    render(<IdeaTree nodes={nodes} />);
    const link = screen.getByText("Притлумлена ідея").closest("a");
    expect(link?.className).toContain("opacity-50");
  });

  test("не притлумлений вузол — без класу прозорості", () => {
    const nodes = [makeNode({ id: "vivid-1", title: "Звичайна ідея", dimmed: false })];
    render(<IdeaTree nodes={nodes} />);
    const link = screen.getByText("Звичайна ідея").closest("a");
    expect(link?.className).not.toContain("opacity-50");
  });

  test("посилання веде на /ideas/{id}", () => {
    const nodes = [makeNode({ id: "abc-123", title: "Посилання" })];
    render(<IdeaTree nodes={nodes} />);
    const link = screen.getByText("Посилання").closest("a");
    expect(link?.getAttribute("href")).toBe("/ideas/abc-123");
  });

  test("код відмови показується лише коли він заданий", () => {
    const nodes = [
      makeNode({ id: "r-1", title: "З відмовою", rejection_code: "LEGAL" }),
      makeNode({ id: "r-2", title: "Без відмови" }),
    ];
    render(<IdeaTree nodes={nodes} />);
    expect(screen.getByTitle("Юридична заборона")).toBeDefined();
  });
});
