import type { ShieldEvent, LogSink } from "./types";
import { shieldBus } from "./bus";

// ── Memory sink (default) ──────────────────────────────────────────────────────
// Ring-buffer capped at CAP events. Excess events are silently dropped.
// Consumers call drain() to retrieve and clear the buffer.

const CAP = 10_000;

class MemorySink {
  private buf: ShieldEvent[] = [];
  private drops = 0;

  write(event: ShieldEvent): void {
    if (this.buf.length >= CAP) { this.drops++; return; }
    this.buf.push(event);
  }

  drain(): ShieldEvent[] { return this.buf.splice(0); }
  get size(): number { return this.buf.length; }
  get dropped(): number { return this.drops; }
}

export const memorySink = new MemorySink();

// ── Active sink registry ───────────────────────────────────────────────────────

let activeSink: LogSink = (ev) => memorySink.write(ev);

export function setSink(fn: LogSink): void { activeSink = fn; }
export function getSink(): LogSink { return activeSink; }

// ── Non-blocking write queue ───────────────────────────────────────────────────
// enqueueEvent() returns synchronously — the request path never awaits.
// Actual sink writes happen in a setImmediate drain loop so they're off the
// critical path. For async sinks (e.g. ClickHouse HTTP inserts) the drain loop
// awaits each batch concurrently via Promise.allSettled.

let queue: ShieldEvent[] = [];
let draining = false;

export function enqueueEvent(event: ShieldEvent): void {
  // Broadcast synchronously to in-process listeners first (cheap)
  shieldBus.emit("event", event);

  queue.push(event);
  if (!draining) {
    draining = true;
    setImmediate(drain);
  }
}

function drain(): void {
  draining = false;
  if (queue.length === 0) return;

  const batch = queue.splice(0); // grab all pending

  // Run concurrently; errors in one item never abort the batch
  void Promise.allSettled(
    batch.map((ev) => {
      try {
        const r = activeSink(ev);
        return r instanceof Promise ? r : Promise.resolve();
      } catch {
        return Promise.resolve();
      }
    })
  ).then(() => {
    // Re-schedule if more events arrived during this batch
    if (queue.length > 0) {
      draining = true;
      setImmediate(drain);
    }
  });
}
