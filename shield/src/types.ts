export interface ShieldEvent {
  ts: number;
  run_id: string;
  session_id: string;
  ip: string;
  user_agent: string;
  method: string;
  path: string;
  status: number;
  flagged: boolean;
  flag_reason: string | null;
  is_decoy: boolean;
}

// Pluggable sink: sync or async, never throws into the proxy
export type LogSink = (event: ShieldEvent) => void | Promise<void>;

export interface Confession {
  run_id: string;
  session_id: string;
  objective?: unknown;
  targets?: unknown;
  raw_body: unknown;
  ts: number;
}
