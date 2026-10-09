import "dotenv/config";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { detectAttack } from "./detector";
import type { Request, Response, NextFunction } from "express";

const PORT = parseInt(process.env.SHIELD_PORT ?? "4000", 10);
const TWIN_URL = process.env.TWIN_URL ?? "http://localhost:3000";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:4001";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Inspection middleware — runs before the proxy
app.use(async (req: Request, res: Response, next: NextFunction) => {
  const raw = JSON.stringify({
    path: req.path,
    query: req.query,
    body: req.body,
    headers: req.headers,
  });

  const result = detectAttack(raw, req.path, req.method);

  if (result.blocked) {
    console.log(`[SHIELD] BLOCKED ${req.method} ${req.path} — ${result.category}`);
    await notifyOrchestrator({
      path: req.path,
      method: req.method,
      payload: raw,
      category: result.category,
      blocked: true,
    });
    res.status(403).json({ error: "Blocked by security twin", category: result.category });
    return;
  }

  console.log(`[SHIELD] PASS    ${req.method} ${req.path}`);
  await notifyOrchestrator({
    path: req.path,
    method: req.method,
    payload: raw,
    category: result.category ?? "unknown",
    blocked: false,
  });

  next();
});

// Proxy all unblocked traffic to the twin
app.use(
  "/",
  createProxyMiddleware({
    target: TWIN_URL,
    changeOrigin: true,
    on: {
      error: (err: Error, req: express.Request, res: express.Response) => {
        console.error("[SHIELD] Proxy error:", err.message);
        (res as express.Response).status(502).json({ error: "Twin unreachable" });
      },
    },
  })
);

async function notifyOrchestrator(data: object): Promise<void> {
  try {
    await fetch(`${ORCHESTRATOR_URL}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    // orchestrator may not be running; continue silently
  }
}

app.listen(PORT, () => {
  console.log(`[SHIELD] Listening on :${PORT} → proxying to ${TWIN_URL}`);
});
