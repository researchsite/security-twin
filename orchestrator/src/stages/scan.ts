import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import type { StageDef, StageResult, StageContext } from "../pipeline";

const execAsync = promisify(exec);

// ── Demo fallback (semgrep not installed) ─────────────────────────────────────

const DEMO_SEMGREP: SemgrepOutput = {
  results: [
    {
      check_id: "rules.memory.idor-kit-no-owner-check",
      path: "src/index.ts",
      start: { line: 118, col: 15 },
      end:   { line: 118, col: 39 },
      extra: {
        message:  "IDOR (CWE-639): Kit fetched without owner check. Use getKitForUser instead.",
        severity: "ERROR",
        lines:    "  const kit = getKit(req.params.id); // IDOR: no owner check",
      },
    },
  ],
  errors: [],
  stats: { total_time: 0.84, files_checked: 3 },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface SemgrepFinding {
  check_id: string;
  path: string;
  start: { line: number; col: number };
  end:   { line: number; col: number };
  extra: { message: string; severity: string; lines: string };
}

interface SemgrepOutput {
  results: SemgrepFinding[];
  errors: unknown[];
  stats: { total_time: number; files_checked: number };
}

// ── Runners ───────────────────────────────────────────────────────────────────

async function runSemgrep(dir: string, emit: StageContext["emit"]): Promise<{ output: SemgrepOutput; demo: boolean }> {
  emit({ type: "log", stage: "scan", message: "semgrep scan --config auto --json ..." });
  try {
    // semgrep exits 1 when findings exist — capture stdout from the error
    const { stdout } = await execAsync(
      "semgrep scan --config auto --json --quiet .",
      { cwd: dir, timeout: 90_000 }
    ).catch((e: NodeJS.ErrnoException & { stdout?: string }) => {
      if (e.stdout) return { stdout: e.stdout };
      throw e;
    });
    const output = JSON.parse(stdout) as SemgrepOutput;
    emit({ type: "log", stage: "scan", message: `semgrep: ${output.results.length} findings` });
    return { output, demo: false };
  } catch (err) {
    emit({ type: "log", stage: "scan", message: `semgrep unavailable — using demo result (${(err as Error).message.slice(0, 60)})` });
    return { output: DEMO_SEMGREP, demo: true };
  }
}

async function runPlumber(dir: string, emit: StageContext["emit"]): Promise<{ raw: string; installed: boolean }> {
  emit({ type: "log", stage: "scan", message: "plumber scan ..." });
  try {
    const { stdout } = await execAsync("plumber scan .", { cwd: dir, timeout: 30_000 });
    return { raw: stdout, installed: true };
  } catch {
    emit({ type: "log", stage: "scan", message: "plumber not installed — skipping" });
    return { raw: "", installed: false };
  }
}

// ── Stage ─────────────────────────────────────────────────────────────────────

async function run(ctx: StageContext): Promise<StageResult> {
  const targetDir = path.join(ctx.work_dir, "demo-app");

  const [semgrepResult, plumberResult] = await Promise.all([
    runSemgrep(targetDir, ctx.emit),
    runPlumber(targetDir, ctx.emit),
  ]);

  const score_before = semgrepResult.output.results.length;

  return {
    status: "done",
    demo: semgrepResult.demo,
    data: {
      semgrep:      semgrepResult.output,
      plumber:      plumberResult,
      score_before,
      finding_count: score_before,
    },
    duration_ms: 0,
  };
}

export const scanStage: StageDef = { name: "scan", run };
