export type AttackCategory =
  | "sql_injection"
  | "xss"
  | "path_traversal"
  | "idor"
  | "auth_bypass"
  | "ssrf"
  | "command_injection"
  | "header_injection"
  | "open_redirect"
  | "mass_assignment";

export type AttackOutcome = "blocked" | "passed" | "error";

export interface AttackEvent {
  id: string;
  ts: number;
  category: AttackCategory;
  payload: string;
  targetPath: string;
  method: string;
  statusCode: number;
  outcome: AttackOutcome;
  responseSnippet?: string;
  durationMs: number;
}

export interface RunSummary {
  runId: string;
  startedAt: number;
  finishedAt?: number;
  twinUrl: string;
  totalAttacks: number;
  blocked: number;
  passed: number;
  events: AttackEvent[];
}
