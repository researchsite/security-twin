/**
 * traffic.ts — High-volume traffic generator.
 *
 * Floods the shield with realistic mixed traffic to exercise ClickHouse at scale.
 * Uses Node.js native http/https with keep-alive — no extra dependencies.
 *
 * Usage:
 *   ts-node src/traffic.ts
 *   ts-node src/traffic.ts --rate 5000 --seconds 120 --run-id load-test-01
 *
 * Traffic mix:
 *   70% normal browsing   — varied users, IPs, UAs
 *   20% attacker traffic  — sequential IDOR enumeration from a few "attacker" IPs
 *   10% decoy hits        — paths listed in robots.txt
 */

import * as http  from "http";
import * as https from "https";
import { URL } from "url";

// ── CLI ────────────────────────────────────────────────────────────────────────

interface Opts { rate: number; seconds: number; runId: string }

function parseArgs(): Opts {
  const a = process.argv.slice(2);
  let rate = 2_000, seconds = 60, runId = `traffic-${Date.now()}`;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--rate"     && a[i + 1]) rate    = parseInt(a[++i], 10);
    if (a[i] === "--seconds"  && a[i + 1]) seconds = parseInt(a[++i], 10);
    if (a[i] === "--run-id"   && a[i + 1]) runId   = a[++i];
  }
  return { rate, seconds, runId };
}

const opts = parseArgs();

// ── Target ─────────────────────────────────────────────────────────────────────

const SHIELD    = new URL(process.env.SHIELD_URL ?? "http://localhost:8080");
const IS_HTTPS  = SHIELD.protocol === "https:";
const HOST      = SHIELD.hostname;
const PORT      = SHIELD.port ? parseInt(SHIELD.port, 10) : (IS_HTTPS ? 443 : 80);
const BASE_PATH = SHIELD.pathname.replace(/\/$/, "");

// ── Connection pool ────────────────────────────────────────────────────────────
// maxSockets caps concurrent TCP connections per host.
// maxFreeSockets keeps idle sockets alive to avoid TCP setup overhead.

const MAX_CONCURRENT = Math.min(Math.ceil(opts.rate * 0.3), 500);

const agentOpts: http.AgentOptions = {
  keepAlive:      true,
  maxSockets:     MAX_CONCURRENT,
  maxFreeSockets: Math.ceil(MAX_CONCURRENT / 4),
};
const AGENT = IS_HTTPS ? new https.Agent(agentOpts) : new http.Agent(agentOpts);

// ── Traffic data ───────────────────────────────────────────────────────────────

const DEMO_USERS     = ["alice", "bob", "carol", "dave", "eve", "frank", "grace"];
const ATTACKER_USERS = ["scanner", "root", "admin", "test"];

const NORMAL_PATHS = [
  "/",
  "/api/kits",
  "/api/users",
  "/healthz",
  "/about",
  "/api/kits?page=1",
  "/api/kits?page=2",
];

const DECOY_PATHS = [
  "/admin-backup/",
  "/api/internal/export",
  "/api/v0/debug",
  "/admin-backup/config.json",
  "/api/internal/export?format=csv",
];

const ATTACKER_UA = "python-requests/2.31.0";

const NORMAL_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "curl/8.6.0",
  "Go-http-client/1.1",
  "axios/1.6.8",
  "node-fetch/3.3.2",
  "Wget/1.21.4 (linux-gnu)",
  "HTTPie/3.2.2",
];

// Pre-generate IP pools — fixed for the run so ClickHouse sessions look realistic
function makeIpPool(n: number, prefix?: string): string[] {
  const ips: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = prefix ? parseInt(prefix.split(".")[0], 10) : Math.floor(Math.random() * 200 + 10);
    ips.push(
      `${a}.${Math.floor(Math.random() * 254 + 1)}.${Math.floor(Math.random() * 254 + 1)}.${Math.floor(Math.random() * 254 + 1)}`
    );
  }
  return ips;
}

const NORMAL_IPS   = makeIpPool(50);        // 50 distinct "user" IPs
const ATTACKER_IPS = makeIpPool(5, "185");  // 5 "attacker" IPs in 185.x.x.x range

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Request spec ───────────────────────────────────────────────────────────────

interface ReqSpec {
  method: string;
  urlPath: string;
  headers: Record<string, string>;
}

function pickRequest(runId: string): ReqSpec {
  const roll = Math.random();

  if (roll < 0.70) {
    // 70% — normal browsing
    return {
      method:  "GET",
      urlPath: BASE_PATH + pick(NORMAL_PATHS),
      headers: {
        "user-agent":      pick(NORMAL_UAS),
        "x-forwarded-for": pick(NORMAL_IPS),
        "x-demo-user":     pick(DEMO_USERS),
        "x-run-id":        runId,
        "accept":          "application/json,text/html;q=0.9,*/*;q=0.8",
      },
    };
  } else if (roll < 0.90) {
    // 20% — attacker: enumerate kit IDs from a few IPs
    const kitId = Math.floor(Math.random() * 12) + 1;
    return {
      method:  "GET",
      urlPath: `${BASE_PATH}/api/kits/${kitId}`,
      headers: {
        "user-agent":      ATTACKER_UA,
        "x-forwarded-for": pick(ATTACKER_IPS),
        "x-demo-user":     pick(ATTACKER_USERS),
        "x-run-id":        runId,
      },
    };
  } else {
    // 10% — decoy hit
    return {
      method:  "GET",
      urlPath: BASE_PATH + pick(DECOY_PATHS),
      headers: {
        "user-agent":      pick(NORMAL_UAS),
        "x-forwarded-for": pick(ATTACKER_IPS),
        "x-run-id":        runId,
      },
    };
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────────

let sent     = 0;
let ok       = 0;
let errors   = 0;
let inFlight = 0;
const statusCounts: Record<number, number> = {};
const startMs = Date.now();

// ── Request dispatch ───────────────────────────────────────────────────────────

function fireRequest(spec: ReqSpec): void {
  if (inFlight >= MAX_CONCURRENT) return; // back-pressure: drop rather than queue
  inFlight++;
  sent++;

  const reqOpts: http.RequestOptions = {
    hostname: HOST,
    port:     PORT,
    path:     spec.urlPath,
    method:   spec.method,
    headers:  spec.headers,
    agent:    AGENT,
  };

  const req = (IS_HTTPS ? https : http).request(reqOpts, (res) => {
    const code = res.statusCode ?? 0;
    statusCounts[code] = (statusCounts[code] ?? 0) + 1;
    ok++;
    inFlight--;
    res.resume(); // drain so the socket returns to the pool
  });

  req.on("error", () => { errors++; inFlight--; });

  // Abort stale requests so sockets don't pile up
  req.setTimeout(5_000, () => { req.destroy(); });

  req.end();
}

// ── Run ────────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const durationMs  = opts.seconds * 1_000;
  const endMs       = Date.now() + durationMs;

  // Batch every 10 ms so we avoid one-timer-per-request overhead.
  const BATCH_INTERVAL = 10;
  const batchSize = Math.max(1, Math.round(opts.rate * BATCH_INTERVAL / 1_000));

  process.stderr.write(
    `[traffic] rate=${opts.rate}/s  duration=${opts.seconds}s  run_id=${opts.runId}\n` +
    `[traffic] batch=${batchSize}req per ${BATCH_INTERVAL}ms  maxConcurrent=${MAX_CONCURRENT}\n` +
    `[traffic] target=${SHIELD.href}\n`
  );

  await new Promise<void>(resolve => {
    const timer = setInterval(() => {
      if (Date.now() >= endMs) { clearInterval(timer); resolve(); return; }
      for (let i = 0; i < batchSize; i++) fireRequest(pickRequest(opts.runId));
    }, BATCH_INTERVAL);
  });

  // Drain in-flight requests (max 5 s)
  await new Promise<void>(resolve => {
    let waited = 0;
    const drain = setInterval(() => {
      waited += 100;
      if (inFlight === 0 || waited > 5_000) { clearInterval(drain); resolve(); }
    }, 100);
  });

  printStats();
}

// ── Stats output ───────────────────────────────────────────────────────────────

function printStats(): void {
  const elapsed = (Date.now() - startMs) / 1_000;
  const actualRps = (sent / elapsed).toFixed(0);

  const summary = {
    run_id:       opts.runId,
    target:       SHIELD.href,
    duration_s:   +elapsed.toFixed(2),
    sent,
    ok,
    errors,
    actual_rps:   +actualRps,
    status_codes: statusCounts,
  };

  // Final summary always goes to stdout as JSON
  process.stdout.write(JSON.stringify(summary) + "\n");

  // Human-readable to stderr
  process.stderr.write(
    `\n[traffic] ── Summary ──────────────────────────────\n` +
    `[traffic] duration : ${elapsed.toFixed(1)}s\n` +
    `[traffic] sent     : ${sent.toLocaleString()}\n` +
    `[traffic] ok       : ${ok.toLocaleString()}\n` +
    `[traffic] errors   : ${errors.toLocaleString()}\n` +
    `[traffic] actual   : ${actualRps} req/s\n` +
    `[traffic] statuses : ${JSON.stringify(statusCounts)}\n` +
    `[traffic] ────────────────────────────────────────\n`
  );
}

run().catch(err => {
  process.stderr.write(`[traffic] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
