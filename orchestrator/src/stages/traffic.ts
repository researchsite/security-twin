import { spawn } from "child_process";
import * as path from "path";
import type { StageDef, StageResult, StageContext } from "../pipeline";

const RATE_RPS = 1_000;
const DURATION_S = 25;

async function run(ctx: StageContext): Promise<StageResult> {
  const shieldUrl = process.env.SHIELD_URL ?? "http://localhost:8080";

  ctx.emit({ type: "log", stage: "traffic", message: `Flooding ${shieldUrl} at ${RATE_RPS} rps for ${DURATION_S}s (run_id=${ctx.run_id})` });

  return new Promise<StageResult>((resolve) => {
    const tsNodeBin = path.join(ctx.root_dir, "attacker/node_modules/ts-node/dist/bin.js");
    const proc = spawn(
      process.execPath,
      [tsNodeBin, "src/traffic.ts",
        "--rate",     String(RATE_RPS),
        "--seconds",  String(DURATION_S),
        "--run-id",   ctx.run_id,
      ],
      {
        cwd: path.join(ctx.root_dir, "attacker"),
        env: { ...process.env, SHIELD_URL: shieldUrl },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let lastLine = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      lastLine = chunk.toString().trim();
      ctx.emit({ type: "log", stage: "traffic", message: lastLine });
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      ctx.emit({ type: "log", stage: "traffic", message: chunk.toString().trim() });
    });

    proc.on("close", (code) => {
      let stats: unknown = { exit_code: code };
      try { stats = JSON.parse(lastLine) as unknown; } catch { /* not JSON */ }
      ctx.emit({ type: "data", stage: "traffic", data: stats });
      resolve({ status: "done", data: stats, duration_ms: 0 });
    });

    proc.on("error", (err) => {
      ctx.emit({ type: "log", stage: "traffic", message: `spawn error: ${err.message}` });
      resolve({ status: "error", data: { error: err.message }, duration_ms: 0 });
    });
  });
}

export const trafficStage: StageDef = { name: "traffic", run };
