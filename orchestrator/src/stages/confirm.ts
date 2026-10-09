import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import type { StageDef, StageResult, StageContext } from "../pipeline";

const execAsync = promisify(exec);

const DEMO_CONFIRM = {
  findings: [
    {
      check_id: "rules.memory.idor-kit-no-owner-check",
      path:     "demo-app/src/index.ts",
      start:    { line: 118, col: 15 },
      end:      { line: 118, col: 39 },
      extra: {
        message:  "IDOR (CWE-639): Kit fetched without owner check. Use getKitForUser instead.",
        severity: "ERROR",
        lines:    "  const kit = getKit(req.params.id); // IDOR: no owner check",
      },
    },
  ],
  confirmed: true,
  demo: true,
};

async function run(ctx: StageContext): Promise<StageResult> {
  const mapResult = ctx.results["map"];
  const sourceFile =
    (mapResult?.data as { source_file?: string } | undefined)?.source_file ??
    path.join(ctx.work_dir, "demo-app", "src", "index.ts");

  const rulesPath = path.join(ctx.root_dir, "rules/memory/idor.yaml");

  ctx.emit({ type: "log", stage: "confirm", message: `Running custom IDOR rule on ${path.basename(sourceFile)}` });

  try {
    const { stdout } = await execAsync(
      `semgrep --config "${rulesPath}" --json --quiet "${sourceFile}"`,
      { timeout: 30_000 }
    ).catch((e: NodeJS.ErrnoException & { stdout?: string }) => {
      if (e.stdout) return { stdout: e.stdout };
      throw e;
    });

    const result = JSON.parse(stdout) as { results: unknown[] };
    const confirmed = result.results.length > 0;

    ctx.emit({ type: "log", stage: "confirm", message: confirmed ? `IDOR confirmed (${result.results.length} match)` : "No match from custom rule" });

    return { status: "done", data: { ...result, confirmed }, duration_ms: 0 };
  } catch {
    ctx.emit({ type: "log", stage: "confirm", message: "semgrep unavailable — using demo confirm result" });
    return { status: "done", demo: true, data: DEMO_CONFIRM, duration_ms: 0 };
  }
}

export const confirmStage: StageDef = { name: "confirm", run };
