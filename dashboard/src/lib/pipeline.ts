export interface PipelineEvent {
  type: "stage_start" | "stage_done" | "stage_error" | "log" | "data" | "run_done" | "needs_decision";
  stage?: string;
  ts: number;
  data?: unknown;
  message?: string;
  error?: string;
}

export const STAGE_NAMES = [
  "clone", "scan", "attack", "traffic",
  "detect", "map", "confirm", "remember", "fix", "prove", "sync", "alert", "brief",
] as const;

export type StageName = typeof STAGE_NAMES[number];
export type StageStatus = "pending" | "running" | "done" | "failed";

export interface StageState {
  status: StageStatus;
  startedAt?: number;
  duration_ms?: number;
  demo?: boolean;
  data?: unknown;
  logs: string[];
  error?: string;
}

export function emptyStages(): Record<StageName, StageState> {
  return Object.fromEntries(
    STAGE_NAMES.map(s => [s, { status: "pending" as StageStatus, logs: [] }])
  ) as unknown as Record<StageName, StageState>;
}

// ── Agent events (attack stage) ───────────────────────────────────────────────

export interface AgentRequest  { n: number; method: string; url: string; user?: string }
export interface AgentResponse { status: number; body: string }
export interface AgentReasoning { name: string; args: string }
export interface AgentFinal    { summary: string }

export interface AgentEvent {
  type: "request" | "response" | "reasoning" | "final";
  data: AgentRequest | AgentResponse | AgentReasoning | AgentFinal;
}

// ── Confession (remember stage) ───────────────────────────────────────────────

export interface Confession {
  session_id: string;
  objective?: string;
  targets?: string[];
  ts: number;
}

// ── Detection (detect stage) ──────────────────────────────────────────────────

export interface DetectionFinding {
  ip: string;
  total_kit_hits: number;
  distinct_kit_ids: number;
  first_seen: string;
  last_seen: string;
  window_minutes: number;
}

// ── Semgrep (scan / confirm stage) ───────────────────────────────────────────

export interface SemgrepFinding {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end:   { line: number; col: number };
  extra: { message: string; severity: string; lines: string };
}

// ── Fix stage ─────────────────────────────────────────────────────────────────

export type FixChoice = "non_breaking" | "signature_change";

export interface FixCallSite {
  file: string;
  line: number;
  text: string;
}

export interface FixBlastRadius {
  function_name: string;
  callers: FixCallSite[];
  count: number;
}

export interface FixOption {
  choice: FixChoice;
  label: string;
  description: string;
  signature_change: boolean;
  patch_preview: string;
}

export interface FixData {
  fix_type: FixChoice;
  blast_radius: FixBlastRadius;
  options: FixOption[];
  recommendation: FixChoice;
  auto_applied: boolean;
  needs_decision: boolean;
  patch: string;
  score_before: number;
  score_after: number;
  source_file: string;
}

export interface NeedsDecisionData {
  options: FixOption[];
  blast_radius: FixBlastRadius;
  recommendation: FixChoice;
  reason: string;
}

// ── Prove stage ───────────────────────────────────────────────────────────────

export interface ProbeEventRequest  { n: number; method: string; url: string; user: string }
export interface ProbeEventResponse { status: number; body: string; pass: boolean }

export interface ProbeEvent {
  type: "request" | "response";
  data: ProbeEventRequest | ProbeEventResponse;
}

export interface ProveProbe {
  n: number;
  method: string;
  url: string;
  user: string;
  status: number;
  expected: number;
  pass: boolean;
  body: string;
}

export interface ProveData {
  probes: ProveProbe[];
  score_after: number;
  all_pass: boolean;
  demo: boolean;
}

// ── Sync stage ────────────────────────────────────────────────────────────────

export interface SyncData {
  skipped:            boolean;
  reason?:            string;
  branch:             string;
  repo?:              string;
  pr_url?:            string;
  pr_number?:         number;
  files_committed:    string[];
  fix_type:           string;
  blast_radius_count: number;
  pr_body?:           string;
}

// ── Alert stage ───────────────────────────────────────────────────────────────

export interface AlertData {
  skipped:    boolean;
  reason?:    string;
  /** "approved" | "rejected" | "no_answer" | "no_decision" | "failed" | "skipped" */
  outcome:    string;
  approved:   boolean | null;
  to_masked?: string;
  demo:       boolean;
}

// ── Brief stage ───────────────────────────────────────────────────────────────

export interface BriefData {
  text:        string;
  tts_ok:      boolean;
  audio_path?: string;
  demo:        boolean;
}
