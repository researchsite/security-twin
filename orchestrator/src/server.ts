import "dotenv/config";
import * as fsPromises from "fs/promises";
import express, { type Request, type Response } from "express";
import * as pipeline from "./pipeline";
import * as memory from "./memory";
import { initClickHouse } from "./ch-store";
import { initRequestsSchema } from "./ch-requests";
import { cloneStage }              from "./stages/clone";
import { scanStage }               from "./stages/scan";
import { attackStage }             from "./stages/attack";
import { trafficStage }            from "./stages/traffic";
import { detectStage }             from "./stages/detect";
import { mapStage }                from "./stages/map";
import { confirmStage }            from "./stages/confirm";
import { rememberStage }           from "./stages/remember";
import { fixStage, resolveDecision } from "./stages/fix";
import type { FixChoice }          from "./stages/fix";
import { proveStage }               from "./stages/prove";
import { syncStage }                from "./stages/sync";
import { alertStage }               from "./stages/alert";
import { briefStage }               from "./stages/brief";

const PORT = parseInt(process.env.PORT ?? "4001", 10);

const STAGES: pipeline.StageDef[] = [
  cloneStage,
  scanStage,
  attackStage,
  trafficStage,
  detectStage,
  mapStage,
  confirmStage,
  rememberStage,
  fixStage,
  proveStage,
  syncStage,
  alertStage,
  briefStage,
];

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS — dashboard lives on a different port
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ status: "ok", ts: Date.now() });
});

// ── Start a pipeline run ──────────────────────────────────────────────────────

app.post("/run/start", (req: Request, res: Response) => {
  const run_id: string = (req.body as { run_id?: string }).run_id ?? `run-${Date.now()}`;

  // Kick off asynchronously — client subscribes via SSE
  pipeline.startRun(run_id, STAGES).catch((err: Error) =>
    console.error(`[ORCH] pipeline error run=${run_id}:`, err.message)
  );

  res.json({ run_id, stream: `/api/runs/${run_id}/stream` });
});

// ── SSE stream ────────────────────────────────────────────────────────────────

app.get("/api/runs/:id/stream", (req: Request, res: Response) => {
  const { id } = req.params;

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  // Heartbeat every 15s to keep connection alive through proxies
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);

  const send = (event: pipeline.PipelineEvent): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  pipeline.subscribe(id, send);

  req.on("close", () => {
    clearInterval(heartbeat);
    pipeline.unsubscribe(id, send);
  });
});

// ── Fix-stage decision gate ───────────────────────────────────────────────────
//
// When the fix stage emits needs_decision (signature change + risky blast
// radius), it holds a pending Promise.  This endpoint resolves it.

app.post("/api/runs/:id/decide", (req: Request, res: Response) => {
  const { id }    = req.params;
  const { choice } = req.body as { choice?: FixChoice };
  if (choice !== "non_breaking" && choice !== "signature_change") {
    res.status(400).json({ error: "choice must be non_breaking or signature_change" });
    return;
  }
  const ok = resolveDecision(id, choice);
  res.json({ ok, run_id: id, choice });
});

// ── Brief audio ──────────────────────────────────────────────────────────────
//
// The brief stage saves brief.mp3 to work_dir.  This endpoint serves it so the
// dashboard audio player can stream it.

app.get("/api/runs/:id/brief.mp3", async (req: Request, res: Response) => {
  const audioPath = `${pipeline.getWorkDir(req.params.id)}/brief.mp3`;
  try {
    const buf = await fsPromises.readFile(audioPath);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Accept-Ranges", "bytes");
    res.end(buf);
  } catch {
    res.status(404).json({ error: "brief audio not available" });
  }
});

// ── Legacy endpoints (dashboard compatibility) ────────────────────────────────

app.get("/run/current", async (_req: Request, res: Response) => {
  const run = await memory.getLatestRun().catch(() => null);
  res.json(run);
});

app.post("/api/runs/:id/events", (req: Request, res: Response) => {
  console.log(`[ORCH] agent event run=${req.params.id}:`, JSON.stringify(req.body).slice(0, 120));
  res.json({ ok: true });
});

app.get("/api/memory", async (_req: Request, res: Response) => {
  const docs = await memory.recall().catch(() => []);
  res.json(docs);
});

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await Promise.all([
    initClickHouse().catch((e: Error) => console.error("[ORCH] CH attack_events:", e.message)),
    initRequestsSchema().catch((e: Error) => console.error("[ORCH] CH requests:", e.message)),
    memory.connect().catch((e: Error) => console.error("[ORCH] MongoDB:", e.message)),
  ]);

  app.listen(PORT, () => {
    console.log(`[ORCHESTRATOR] :${PORT}`);
    console.log(`[ORCHESTRATOR] stages: ${STAGES.map(s => s.name).join(" → ")}`);
  });
}

main().catch((err: Error) => {
  console.error("[ORCHESTRATOR] fatal:", err.message);
  process.exit(1);
});
