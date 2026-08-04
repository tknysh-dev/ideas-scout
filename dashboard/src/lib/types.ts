// Типи рядків Supabase — джерело правди: shared/schema.sql

export type IdeaType = "mechanic" | "niche";
export type SignalType = "income_claim" | "automation_report";
export type IdeaStatus =
  | "new"
  | "analyzing"
  | "rejected"
  | "approved_pending"
  | "accepted"
  | "transferred";
export type RejectionCode =
  | "NO_MONETIZATION"
  | "SOURCE_SUSPECT"
  | "LEGAL"
  | "CAPABILITY_GAP"
  | "CAPITAL"
  | "AUTONOMY"
  | "SATURATED"
  | "NO_MARKET";
export type Confidence = "high" | "medium" | "low";
export type AuthorInterest = "none" | "affiliate" | "course_seller" | "tool_vendor";
export type ResearchDepth = "initial" | "deep";

export interface Idea {
  id: string;
  track: string;
  parent_id: string | null;
  title: string;
  type: IdeaType;
  discovered: string;
  signal_type: SignalType;
  monetization_hypothesis: string | null;
  mentions_count: number;
  claimed_revenue: string | null;
  mechanic_summary: string | null;
  status: IdeaStatus;
  rejection_code: RejectionCode | null;
  rejection_detail: string | null;
  rejection_codes_extra: string[];
  missing_capabilities: string[];
  ceiling_estimate: string | null;
  launch_effort_hours: number | null;
  ceiling_flag: "review" | null;
  review_condition: string | null;
  review_count: number;
  last_reviewed: string | null;
  min_review_interval_days: number;
  confidence: Confidence | null;
  transferred_to: string | null;
  verdict_provider: string | null;
  verdict_model: string | null;
  verdict_run_id: string | null;
  research_depth: ResearchDepth;
  deep_researched_at: string | null;
  deep_research_run_id: string | null;
  schema_version: number;
  criteria_version: string | null;
  body: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceRow {
  id: number;
  idea_id: string;
  url: string;
  origin: string | null;
  published_date: string | null;
  author_interest: AuthorInterest | null;
  independent_confirmations: number;
  quote: string | null;
}

export interface RunRow {
  run_id: string;
  job: string;
  track: string | null;
  provider: string | null;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  errors: unknown;
  token_usage: unknown;
  processed_urls: string[];
  notes: string | null;
  meta: unknown;
}

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRow {
  id: string;
  type: string;
  payload: unknown;
  status: JobStatus;
  requested_by: string;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  worker_id: string | null;
  run_id: string | null;
  last_error: string | null;
}

export type VerdictKind = "model" | "synthesis";
export type CriterionVerdict =
  | "passed"
  | "failed"
  | "owner"
  | "skipped"
  | "not_applicable"
  | "noted";
export type SynthesisResolution =
  | "consensus"
  | "evidence"
  | "cross_exam"
  | "pessimistic_default";

export interface CriteriaVerdictRow {
  id: string;
  idea_id: string;
  run_id: string | null;
  stage: ResearchDepth;
  kind: VerdictKind;
  provider: string;
  model: string | null;
  criterion_key: string;
  verdict: CriterionVerdict;
  score: string | null;
  summary: string | null;
  detail: string | null;
  evidence: unknown;
  resolution: SynthesisResolution | null;
  criteria_version: string | null;
  created_at: string;
}

export interface CompetitorRow {
  id: string;
  idea_id: string;
  run_id: string | null;
  name: string;
  url: string | null;
  pricing: string | null;
  liveness: "active" | "stale" | "dead" | null;
  last_activity: string | null;
  strengths: string | null;
  weaknesses: string | null;
  differentiation: string | null;
  evidence: unknown;
  created_at: string;
}

export interface EventRow {
  id: number;
  idea_id: string;
  happened_at: string;
  run_id: string | null;
  actor: string;
  change: string;
  reason: string | null;
}

export interface InboxRow {
  id: number;
  draft_id: string | null;
  submitted_at: string;
  raw_text: string;
  source: string;
  track: string | null;
  mode: string | null;
  target_card_id: string | null;
  triage_status: string | null;
  triage_verdict: string | null;
  triage_score: number | null;
  idea_id: string | null;
}
