import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PipelineEvent {
  type: "stage_start" | "stage_done" | "stage_error" | "log" | "data" | "run_done" | "needs_decision";
  stage?: string;
  ts: number;
  data?: unknown;
  message?: string;
  error?: string;
}

export interface StageResult {
  status: "done" | "error" | "skipped";
  data: unknown;
  duration_ms: number;
  demo?: boolean;
}

export interface StageContext {
  run_id: string;
  root_dir: string;
  work_dir: string;
  started_at: number;
  emit: (partial: Omit<PipelineEvent, "ts">) => void;
  results: Record<string, StageResult>;
}

export type StageFn = (ctx: StageContext) => Promise<StageResult>;

export interface StageDef {
  name: string;
  run: StageFn;
  critical?: boolean;   // if true, abort the run on failure
}

// ── In-process run registry ───────────────────────────────────────────────────

interface RunEntry {
  state: "pending" | "running" | "done" | "error";
  events: PipelineEvent[];
  emitter: EventEmitter;
}

const runs = new Map<string, RunEntry>();

function getOrCreate(run_id: string): RunEntry {
  if (!runs.has(run_id)) {
    runs.set(run_id, {
      state: "pending",
      events: [],
      emitter: new EventEmitter(),
    });
  }
  return runs.get(run_id)!;
}

/** Subscribe to SSE events for a run. Replays buffered events first. */
export function subscribe(run_id: string, handler: (e: PipelineEvent) => void): void {
  const entry = getOrCreate(run_id);
  // Replay history
  for (const ev of entry.events) handler(ev);
  entry.emitter.on("event", handler);
}

export function unsubscribe(run_id: string, handler: (e: PipelineEvent) => void): void {
  runs.get(run_id)?.emitter.off("event", handler);
}

// ── Pipeline runner ───────────────────────────────────────────────────────────

// process.cwd() is always the orchestrator package directory when started via npm start or ts-node src/server.ts
const ROOT_DIR = process.env.REPO_ROOT ?? path.resolve(process.cwd(), "..");

export function getWorkDir(run_id: string): string {
  return `/tmp/runs/${run_id}`;
}

export async function startRun(run_id: string, stages: StageDef[]): Promise<void> {
  const entry = getOrCreate(run_id);
  if (entry.state === "running") return; // already in flight

  entry.state = "running";

  const emit = (partial: Omit<PipelineEvent, "ts">): void => {
    const ev: PipelineEvent = { ...partial, ts: Date.now() };
    entry.events.push(ev);
    if (entry.events.length > 1_000) entry.events.shift(); // cap history
    entry.emitter.emit("event", ev);
  };

  const work_dir = `/tmp/runs/${run_id}`;
  const ctx: StageContext = {
    run_id,
    root_dir: ROOT_DIR,
    work_dir,
    started_at: Date.now(),
    emit,
    results: {},
  };

  for (const { name, run, critical } of stages) {
    const t0 = Date.now();
    emit({ type: "stage_start", stage: name });

    try {
      const result = await run(ctx);
      result.duration_ms = Date.now() - t0;
      ctx.results[name] = result;
      emit({ type: "stage_done", stage: name, data: result });
    } catch (err) {
      const result: StageResult = {
        status: "error",
        data: { error: (err as Error).message },
        duration_ms: Date.now() - t0,
      };
      ctx.results[name] = result;
      emit({ type: "stage_error", stage: name, error: (err as Error).message });
      if (critical) {
        entry.state = "error";
        emit({ type: "run_done", data: { aborted: true, stage: name } });
        return;
      }
    }
  }

  entry.state = "done";
  emit({ type: "run_done", data: { stages: Object.keys(ctx.results) } });

  // ── Demo recorder ─────────────────────────────────────────────────────────
  // When RECORD_DEMO_RUN=true, write the full event stream to
  // dashboard/public/demo-run.json so future DEMO_MODE replays this real run.
  if (process.env.RECORD_DEMO_RUN === "true") {
    const outPath = path.join(ROOT_DIR, "dashboard", "public", "demo-run.json");
    const payload = JSON.stringify({ run_id, events: entry.events }, null, 2);
    await fs.writeFile(outPath, payload, "utf8").catch((e: Error) =>
      console.error(`[ORCH] recorder: failed to write ${outPath}: ${e.message}`)
    );
    console.log(`[ORCH] recorder: wrote ${entry.events.length} events → ${outPath}`);
  }
}
