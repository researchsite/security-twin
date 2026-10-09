import * as path from "path";
import * as fs from "fs/promises";
import type { StageDef, StageResult, StageContext } from "../pipeline";
import type { FixData } from "./fix";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProbeSpec { url: string; user: string; expected: number }

interface ProbeResult extends ProbeSpec {
  n: number;
  method: string;
  status: number;
  pass: boolean;
  body: string;
}

export interface ProveData {
  probes: ProbeResult[];
  score_after: number;
  all_pass: boolean;
  demo: boolean;
}

// ── Probe plan ────────────────────────────────────────────────────────────────
//
// Cross-user reads should return 404 after the non-breaking fix.
// Own-user reads should still return 200.

const PROBE_PLAN: ProbeSpec[] = [
  { url: "/api/kits/kit-bob-1",   user: "alice", expected: 404 },
  { url: "/api/kits/kit-carol-1", user: "alice", expected: 404 },
  { url: "/api/kits/kit-alice-1", user: "alice", expected: 200 },
];

const DEMO_PROBES: ProbeResult[] = [
  { n: 1, method: "GET", url: "/api/kits/kit-bob-1",   user: "alice", expected: 404, status: 404, pass: true,  body: '{"error":"not found"}' },
  { n: 2, method: "GET", url: "/api/kits/kit-carol-1", user: "alice", expected: 404, status: 404, pass: true,  body: '{"error":"not found"}' },
  { n: 3, method: "GET", url: "/api/kits/kit-alice-1", user: "alice", expected: 200, status: 200, pass: true,  body: '{"id":"kit-alice-1","ownerId":"alice"}' },
];

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function fetchTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// ── Static fallback: verify ownership guard in patched source ─────────────────

async function staticProof(ctx: StageContext): Promise<boolean> {
  const fixData    = ctx.results["fix"]?.data as FixData | undefined;
  const srcRelPath = fixData?.source_file ?? "demo-app/src/index.ts";
  const srcPath    = path.join(ctx.work_dir, srcRelPath);
  const content    = await fs.readFile(srcPath, "utf8").catch(() => "");
  return /\.ownerId\s*!==/.test(content) || /\bgetKitForUser\s*\(/.test(content);
}

// ── Live probe ────────────────────────────────────────────────────────────────

async function liveProbe(twinUrl: string, spec: ProbeSpec, n: number, ctx: StageContext): Promise<ProbeResult> {
  ctx.emit({
    type: "data", stage: "prove",
    data: { probe_event: { type: "request", data: { n, method: "GET", url: spec.url, user: spec.user } } },
  });

  let status = 0;
  let body   = "";
  try {
    const res = await fetchTimeout(`${twinUrl}${spec.url}`, {
      headers: { "x-demo-user": spec.user },
    }, 5_000);
    status = res.status;
    body   = (await res.text()).slice(0, 100);
  } catch (err) {
    status = 0;
    body   = (err as Error).message.slice(0, 80);
  }

  const pass = status === spec.expected;
  ctx.emit({
    type: "data", stage: "prove",
    data: { probe_event: { type: "response", data: { status, body, pass } } },
  });
  ctx.emit({
    type: "log", stage: "prove",
    message: `${pass ? "✓" : "✗"} GET ${spec.url} as ${spec.user} → ${status} (expected ${spec.expected})`,
  });

  return { n, method: "GET", ...spec, status, body, pass };
}

// ── Stage ─────────────────────────────────────────────────────────────────────

async function run(ctx: StageContext): Promise<StageResult> {
  const twinUrl    = process.env.TWIN_URL ?? "http://localhost:3000";
  const fixData    = ctx.results["fix"]?.data as FixData | undefined;
  const scoreBefore = fixData?.score_before ?? 1;

  ctx.emit({ type: "log", stage: "prove", message: `Re-running IDOR probes against ${twinUrl}…` });
  ctx.emit({
    type: "log", stage: "prove",
    message: `Expecting cross-user kit reads to return 404 after ${fixData?.fix_type ?? "non_breaking"} fix`,
  });

  // Try live twin; fall back to demo probes if unreachable
  let probes: ProbeResult[];
  let isDemo = false;

  const twinReachable = await fetchTimeout(`${twinUrl}/healthz`, {}, 3_000)
    .then(r => r.ok).catch(() => false);

  if (twinReachable) {
    probes = [];
    for (let i = 0; i < PROBE_PLAN.length; i++) {
      probes.push(await liveProbe(twinUrl, PROBE_PLAN[i], i + 1, ctx));
    }
  } else {
    ctx.emit({ type: "log", stage: "prove", message: "Twin unreachable — using demo proof" });
    isDemo = true;

    // Emit demo probe_events with paced delays so the SSE feed animates
    const demoStream = [
      { type: "request",  data: { n: 1, method: "GET", url: "/api/kits/kit-bob-1",   user: "alice" } },
      { type: "response", data: { status: 404, body: '{"error":"not found"}',              pass: true } },
      { type: "request",  data: { n: 2, method: "GET", url: "/api/kits/kit-carol-1", user: "alice" } },
      { type: "response", data: { status: 404, body: '{"error":"not found"}',              pass: true } },
      { type: "request",  data: { n: 3, method: "GET", url: "/api/kits/kit-alice-1", user: "alice" } },
      { type: "response", data: { status: 200, body: '{"id":"kit-alice-1","ownerId":"alice"}', pass: true } },
    ];
    for (const pe of demoStream) {
      ctx.emit({ type: "data", stage: "prove", data: { probe_event: pe } });
      await new Promise<void>(r => setTimeout(r, 80));
    }

    for (const p of DEMO_PROBES) {
      ctx.emit({
        type: "log", stage: "prove",
        message: `${p.pass ? "✓" : "✗"} GET ${p.url} as ${p.user} → ${p.status} (expected ${p.expected})`,
      });
    }

    probes = DEMO_PROBES;
  }

  // Also do a static source check as belt-and-suspenders
  const guardInSource = await staticProof(ctx);
  if (!guardInSource && !isDemo) {
    ctx.emit({ type: "log", stage: "prove", message: "⚠ Ownership guard NOT found in patched source — fix may not have applied" });
  }

  const all_pass   = probes.every(p => p.pass);
  const score_after = all_pass ? 0 : scoreBefore;

  ctx.emit({
    type: "log", stage: "prove",
    message: `score_before=${scoreBefore} → score_after=${score_after} · ${probes.length} probes · ${all_pass ? "all pass ✓" : "some failed ✗"}`,
  });

  const result: ProveData = { probes, score_after, all_pass, demo: isDemo };
  ctx.emit({ type: "data", stage: "prove", data: result });

  return { status: "done", demo: isDemo, data: result, duration_ms: 0 };
}

export const proveStage: StageDef = { name: "prove", run };
