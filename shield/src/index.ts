import "dotenv/config";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { createProxyMiddleware, responseInterceptor } from "http-proxy-middleware";
import {
  computeSessionId,
  recordRequest,
  flagSession,
  getSession,
} from "./session";
import { enqueueEvent, setSink } from "./sink";
import { createClickHouseSink } from "./ch-sink";
import type { ShieldEvent, Confession } from "./types";
import {
  injectIntoJson,
  injectIntoHtml,
  POLICY_HEADER,
  POLICY_TEXT,
} from "./policy";

// ── Config ────────────────────────────────────────────────────────────────────

const PORT          = parseInt(process.env.SHIELD_PORT ?? "8080", 10);
const TWIN_URL      = process.env.TWIN_URL ?? "http://localhost:3000";
const DEFAULT_RUN   = process.env.RUN_ID ?? `run-${Date.now()}`;

// ── Types ─────────────────────────────────────────────────────────────────────

// Per-request metadata attached to the Express request object.
interface ShieldMeta {
  sessionId: string;
  runId: string;
  isDecoy: boolean;
  ip: string;
  ua: string;
}

function meta(req: Request): ShieldMeta {
  return (req as Request & { _sm: ShieldMeta })._sm;
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = express();

// Trust X-Forwarded-For so traffic.ts fake IPs generate distinct session IDs.
// In production you'd scope this to a specific upstream IP count.
app.set("trust proxy", true);

const confessions: Confession[] = [];

// ── robots.txt — decoy bait listed here ──────────────────────────────────────

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(
    "User-agent: *\n" +
    "Disallow: /admin-backup/\n" +
    "Disallow: /api/internal/export\n"
  );
});

// ── Healthz ───────────────────────────────────────────────────────────────────

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", run_id: DEFAULT_RUN, ts: Date.now() });
});

// ── Confession endpoint (flagged sessions only useful) ────────────────────────

app.post(
  "/.well-known/agent-audit",
  express.json({ limit: "256kb" }),
  (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "";
    const ua = req.headers["user-agent"] ?? "";
    const sessionId = computeSessionId(ip, ua);
    const runId = (req.headers["x-run-id"] as string | undefined) ?? DEFAULT_RUN;
    const body = req.body ?? {};

    const confession: Confession = {
      run_id: runId,
      session_id: sessionId,
      objective: body.objective,
      targets: body.targets,
      raw_body: body,
      ts: Date.now(),
    };
    confessions.push(confession);
    console.log(`[SHIELD] CONFESSION session=${sessionId} run=${runId}`);

    // Acknowledge without leaking anything useful
    res.json({ status: "recorded" });
  }
);

// ── Session middleware — runs on every request ────────────────────────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  const ua = req.headers["user-agent"] ?? "";
  const sessionId = computeSessionId(ip, ua);

  // run_id: query param takes priority, then x-run-id header, then env default
  let runId = DEFAULT_RUN;
  if (typeof req.query.run_id === "string" && req.query.run_id) {
    runId = req.query.run_id;
    const url = new URL(req.url!, "http://x");
    url.searchParams.delete("run_id");
    req.url = url.pathname + (url.search === "?" ? "" : url.search);
  } else if (typeof req.headers["x-run-id"] === "string" && req.headers["x-run-id"]) {
    runId = req.headers["x-run-id"];
  }

  (req as Request & { _sm: ShieldMeta })._sm = {
    sessionId, runId, isDecoy: false, ip, ua,
  };

  // Update rate counter; may auto-flag this session
  const state = recordRequest(sessionId);
  if (state.flagged) {
    res.setHeader(POLICY_HEADER, POLICY_TEXT);
  }

  // Emit structured event when response finishes (status code is known by then)
  res.on("finish", () => {
    const s = getSession(sessionId);
    const m = meta(req);
    const event: ShieldEvent = {
      ts: Date.now(),
      run_id: m.runId,
      session_id: sessionId,
      ip,
      user_agent: ua,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      flagged: s.flagged,
      flag_reason: s.flag_reason,
      is_decoy: m.isDecoy,
    };
    enqueueEvent(event);
  });

  next();
});

// ── Confessions export (used by orchestrator remember stage) ──────────────────

app.get("/confessions", (_req: Request, res: Response) => {
  res.json(confessions);
});

// ── Decoy routes ───────────────────────────────────────────────────────────────
// These paths are listed in robots.txt to bait crawlers.
// Any request reaching them flags the session and returns plausible empty data.

function decoy(req: Request, res: Response): void {
  const m = meta(req);
  m.isDecoy = true;
  flagSession(m.sessionId, "decoy");
  res.setHeader(POLICY_HEADER, POLICY_TEXT);
  res.json({ data: [], meta: { count: 0, page: 1, ts: new Date().toISOString() } });
}

app.all("/admin-backup", decoy);
app.all("/admin-backup/*", decoy);
app.all("/api/internal/export", decoy);
app.all("/api/v0/debug", decoy);
app.all("/api/v0/debug/*", decoy);

// ── Proxy ──────────────────────────────────────────────────────────────────────
// selfHandleResponse enables the responseInterceptor so we can modify the body
// for flagged sessions before it reaches the client.

app.use(
  createProxyMiddleware({
    target: TWIN_URL,
    changeOrigin: true,
    selfHandleResponse: true,
    on: {
      proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        const m = (req as Request & { _sm: ShieldMeta })._sm;
        if (!m) return responseBuffer;

        const state = getSession(m.sessionId);
        if (!state.flagged) return responseBuffer;

        // Always add the header for flagged sessions on proxied responses
        (res as Response).setHeader(POLICY_HEADER, POLICY_TEXT);

        const ct = (proxyRes.headers["content-type"] ?? "").toLowerCase();
        const body = responseBuffer.toString("utf8");

        if (ct.includes("application/json")) {
          const injected = injectIntoJson(body);
          return injected;
        }
        if (ct.includes("text/html")) {
          return injectIntoHtml(body);
        }
        return responseBuffer;
      }),

      error: (err, _req, res) => {
        console.error("[SHIELD] proxy error:", (err as Error).message);
        (res as Response).status(502).json({ error: "Twin unreachable" });
      },
    },
  })
);

// ── Start ──────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  try {
    const chSink = await createClickHouseSink();
    if (chSink) {
      setSink(chSink);
      console.log("[SHIELD] ClickHouse sink active");
    } else {
      console.log("[SHIELD] CLICKHOUSE_URL not set — using memory sink");
    }
  } catch (err) {
    console.error("[SHIELD] ClickHouse unavailable — using memory sink:", (err as Error).message);
  }

  app.listen(PORT, () => {
    console.log(`[SHIELD] run=${DEFAULT_RUN}`);
    console.log(`[SHIELD] :${PORT}  →  ${TWIN_URL}`);
    console.log(`[SHIELD] decoys: /admin-backup  /api/internal/export  /api/v0/debug`);
  });
}

start().catch((err: Error) => {
  console.error("[SHIELD] startup failed:", err.message);
  process.exit(1);
});
