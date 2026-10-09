import { createHash } from "crypto";

export interface SessionState {
  flagged: boolean;
  flag_reason: string | null;
  count: number;        // requests in current window
  window_start: number; // epoch ms
}

const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;

const store = new Map<string, SessionState>();

export function computeSessionId(ip: string, ua: string): string {
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 12);
}

function getOrCreate(id: string): SessionState {
  let s = store.get(id);
  if (!s) {
    s = { flagged: false, flag_reason: null, count: 0, window_start: Date.now() };
    store.set(id, s);
  }
  return s;
}

export function getSession(id: string): SessionState {
  return getOrCreate(id);
}

// Called on every request. Updates rate counters and auto-flags if over limit.
export function recordRequest(id: string): SessionState {
  const s = getOrCreate(id);
  const now = Date.now();

  if (now - s.window_start > RATE_WINDOW_MS) {
    s.count = 0;
    s.window_start = now;
  }
  s.count++;

  if (!s.flagged && s.count > RATE_MAX) {
    s.flagged = true;
    s.flag_reason = "rate";
    console.log(`[SHIELD] rate-flag session=${id} (${s.count} req / 10s)`);
  }

  return s;
}

// Explicitly flag a session with a given reason (e.g. "decoy").
// Once flagged, the reason is never overwritten.
export function flagSession(id: string, reason: string): void {
  const s = getOrCreate(id);
  if (!s.flagged) {
    s.flagged = true;
    s.flag_reason = reason;
    console.log(`[SHIELD] flag session=${id} reason=${reason}`);
  }
}
