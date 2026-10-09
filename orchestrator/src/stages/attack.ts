import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import type { StageDef, StageResult, StageContext } from "../pipeline";

const DEMO_EVENTS = [
  { type: "request",  data: { n: 1,  method: "GET",  url: "/robots.txt" } },
  { type: "response", data: { status: 200, body: "User-agent: *\nDisallow: /admin-backup/" } },
  { type: "request",  data: { n: 2,  method: "GET",  url: "/api/users" } },
  { type: "response", data: { status: 200, body: '["alice","bob","carol"]' } },
  { type: "request",  data: { n: 3,  method: "GET",  url: "/api/kits", user: "alice" } },
  { type: "response", data: { status: 200, body: '[{"id":"kit-1"},{"id":"kit-2"}]' } },
  { type: "request",  data: { n: 4,  method: "GET",  url: "/api/kits/kit-3", user: "alice" } },
  { type: "response", data: { status: 200, body: '{"id":"kit-3","ownerId":"bob","token":"ghp_FAKE_IDOR_TOKEN"}' } },
  { type: "reasoning", data: { name: "http_request", args: '{"method":"GET","path":"/api/kits/kit-5"}' } },
  { type: "final",    data: { summary: "IDOR confirmed: alice can read kit-3 (bob) and kit-5 (carol) without authorization." } },
];

async function runDemoReplay(ctx: StageContext): Promise<StageResult> {
  ctx.emit({ type: "log", stage: "attack", message: "No API key — replaying demo agent events" });
  for (const ev of DEMO_EVENTS) {
    ctx.emit({ type: "data", stage: "attack", data: { agent_event: ev } });
    await new Promise(r => setTimeout(r, 120));
  }
  return { status: "done", demo: true, data: { events: DEMO_EVENTS, replay: true }, duration_ms: 0 };
}

async function run(ctx: StageContext): Promise<StageResult> {
  const hasKey = !!(
    process.env.ATTACKER_API_KEY ??
    process.env.NEBIUS_API_KEY   ??
    process.env.OPENAI_API_KEY
  );

  // Check if sample-run.json exists to replay (from a previous --record run)
  const sampleFile = path.join(ctx.root_dir, "attacker/recordings/sample-run.json");
  const hasSample = await fs.access(sampleFile).then(() => true).catch(() => false);

  if (!hasKey && !hasSample) return runDemoReplay(ctx);

  const tsNodeBin = path.join(ctx.root_dir, "attacker/node_modules/ts-node/dist/bin.js");
  const agentArgs = [tsNodeBin, "src/agent.ts"];
  if (!hasKey && hasSample) agentArgs.push("--dry");

  ctx.emit({ type: "log", stage: "attack", message: `Spawning agent (${hasKey ? "live" : "dry replay"})…` });

  const events: unknown[] = [];

  return new Promise<StageResult>((resolve) => {
    const proc = spawn(process.execPath, agentArgs, {
      cwd: path.join(ctx.root_dir, "attacker"),
      env: {
        ...process.env,
        SHIELD_URL:   process.env.SHIELD_URL   ?? "http://localhost:8080",
        RUN_ID:       ctx.run_id,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buf = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as unknown;
          events.push(ev);
          ctx.emit({ type: "data", stage: "attack", data: { agent_event: ev } });
        } catch {
          ctx.emit({ type: "log", stage: "attack", message: line });
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      ctx.emit({ type: "log", stage: "attack", message: chunk.toString().trim() });
    });

    proc.on("close", (code) => {
      if (code !== 0 && events.length === 0) {
        runDemoReplay(ctx).then(resolve);
        return;
      }
      resolve({ status: code === 0 ? "done" : "error", data: { events, exit_code: code }, duration_ms: 0 });
    });

    proc.on("error", (err) => {
      ctx.emit({ type: "log", stage: "attack", message: `spawn error: ${err.message} — falling back to demo` });
      runDemoReplay(ctx).then(resolve);
    });
  });
}

export const attackStage: StageDef = { name: "attack", run };
