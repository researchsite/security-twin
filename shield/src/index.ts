import "dotenv/config";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { detectAttack } from "./detector";
import { initClickHouse, persistEvent } from "../../orchestrator/src/ch-store";
import { recordEvent, startRun, getRun } from "../../orchestrator/src/store";
import type { AttackEvent } from "../../orchestrator/src/types";
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";

const PORT       = parseInt(process.env.SHIELD_PORT ?? "4000", 10);
const TWIN_URL   = process.env.TWIN_URL   ?? "http://localhost:3000";

// One run per shield process lifetime
const RUN_ID = `run-${Date.now()}`;
startRun(RUN_ID, TWIN_URL);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Inspection middleware ──────────────────────────────────────────────────────

app.use(async (req: Request, res: Response, next: NextFunction) => {
  const startMs = Date.now();
  const raw = JSON.stringify({
    path:    req.path,
    query:   req.query,
    body:    req.body,
    headers: req.headers,
  });

  const detection = detectAttack(raw, req.path, req.method);
  const durationMs = Date.now() - startMs;

  if (detection.blocked) {
    const event: AttackEvent = {
      id:       randomUUID(),
      ts:       Date.now(),
      category: detection.category as AttackEvent["category"],
      payload:  raw.slice(0, 500),
      targetPath: req.path,
      method:   req.method,
      statusCode: 403,
      outcome:  "blocked",
      durationMs,
      responseSnippet: "Blocked by security twin",
    };
    console.log(`[SHIELD] BLOCKED ${req.method} ${req.path} — ${detection.category}`);
    recordEvent(event);
    void persistEvent(RUN_ID, event);
    res.status(403).json({ error: "Blocked by security twin", category: detection.category });
    return;
  }

  // Attach a listener to capture the upstream status code after proxy responds
  const originalEnd = res.end.bind(res);
  // @ts-ignore — patching for event capture
  res.end = (...args: Parameters<typeof res.end>) => {
    const event: AttackEvent = {
      id:         randomUUID(),
      ts:         Date.now(),
      category:   (detection.category ?? "unknown") as AttackEvent["category"],
      payload:    raw.slice(0, 500),
      targetPath: req.path,
      method:     req.method,
      statusCode: res.statusCode,
      outcome:    "passed",
      durationMs: Date.now() - startMs,
    };
    recordEvent(event);
    void persistEvent(RUN_ID, event);
    console.log(`[SHIELD] PASS    ${req.method} ${req.path} → ${res.statusCode}`);
    return originalEnd(...args);
  };

  next();
});

// ── Health / run status ───────────────────────────────────────────────────────

app.get("/__shield/status", (_req: Request, res: Response) => {
  res.json(getRun());
});

// ── Proxy ─────────────────────────────────────────────────────────────────────

app.use(
  "/",
  createProxyMiddleware({
    target: TWIN_URL,
    changeOrigin: true,
    on: {
      error: (err: Error, _req: express.Request, res: express.Response) => {
        console.error("[SHIELD] Proxy error:", err.message);
        (res as express.Response).status(502).json({ error: "Twin unreachable" });
      },
    },
  })
);

// ── Startup ───────────────────────────────────────────────────────────────────

initClickHouse().then(() => {
  app.listen(PORT, () => {
    console.log(`[SHIELD] run=${RUN_ID}`);
    console.log(`[SHIELD] Listening on :${PORT} → proxying to ${TWIN_URL}`);
  });
});
