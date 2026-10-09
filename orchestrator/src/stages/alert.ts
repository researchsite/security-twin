import * as cp from "child_process";
import * as path from "path";
import type { StageDef, StageResult, StageContext } from "../pipeline";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlertData {
  skipped:    boolean;
  reason?:    string;
  /** "approved" | "rejected" | "no_answer" | "no_decision" | "failed" | "skipped" */
  outcome:    string;
  approved:   boolean | null;
  /** Last 4 digits visible, rest masked — safe to log */
  to_masked?: string;
  demo:       boolean;
}

const CALL_TIMEOUT_MS = 120_000;

// ── Stage ─────────────────────────────────────────────────────────────────────

async function run(ctx: StageContext): Promise<StageResult> {
  const phoneAlerts = process.env.PHONE_ALERTS;
  const toNumber    = process.env.ON_CALL_NUMBER;
  const guavaKey    = process.env.GUAVA_API_KEY;
  const guavaNum    = process.env.GUAVA_AGENT_NUMBER;

  function skip(reason: string): StageResult {
    ctx.emit({ type: "log", stage: "alert", message: `Phone alert skipped — ${reason}` });
    const data: AlertData = { skipped: true, reason, outcome: "skipped", approved: null, demo: false };
    ctx.emit({ type: "data", stage: "alert", data });
    return { status: "done", data, duration_ms: 0 };
  }

  if (phoneAlerts !== "true")  return skip("PHONE_ALERTS not set to true");
  if (!toNumber)               return skip("ON_CALL_NUMBER not set");
  if (!guavaKey || !guavaNum)  return skip("GUAVA_API_KEY or GUAVA_AGENT_NUMBER not configured");

  // ── Build alert text from upstream stage data ──────────────────────────────

  const confirmData = ctx.results["confirm"]?.data as {
    findings?: Array<{ extra?: { message?: string } }>
  } | undefined;
  const detectData = ctx.results["detect"]?.data as {
    total_kit_hits?: number
  } | undefined;
  const syncData = ctx.results["sync"]?.data as {
    pr_url?: string; skipped?: boolean
  } | undefined;

  const alertText  = (
    confirmData?.findings?.[0]?.extra?.message
    ?? "An IDOR vulnerability was confirmed in the kit API."
  ).slice(0, 200);

  const impactText = detectData
    ? `${detectData.total_kit_hits ?? "multiple"} unauthorized cross-user kit accesses were observed.`
    : "Unauthorized cross-user data access is possible.";

  const prUrl = (syncData && !syncData.skipped && syncData.pr_url) ? syncData.pr_url : "";

  // SECURITY: only confirm keys were found — never log values
  ctx.emit({ type: "log", stage: "alert", message: "GUAVA_API_KEY found · GUAVA_AGENT_NUMBER found · ON_CALL_NUMBER found" });
  ctx.emit({ type: "log", stage: "alert", message: "Placing outbound security alert call…" });
  if (prUrl) ctx.emit({ type: "log", stage: "alert", message: "PR URL will be included in the call" });

  // ── Resolve ts-node and expert paths ──────────────────────────────────────

  let tsNodeBin: string;
  try {
    // When running in-process under ts-node, require.resolve finds the orchestrator's ts-node
    tsNodeBin = require.resolve("ts-node/dist/bin");
  } catch {
    tsNodeBin = path.resolve(__dirname, "../../node_modules/ts-node/dist/bin.js");
  }
  const expertPath = path.resolve(__dirname, "../guava-expert.ts");

  // ── Spawn Guava expert subprocess ─────────────────────────────────────────

  const callResult = await spawnExpert(tsNodeBin, expertPath, {
    ALERT_TO:           toNumber,
    ALERT_TEXT:         alertText,
    ALERT_IMPACT:       impactText,
    ALERT_PR_URL:       prUrl,
    GUAVA_API_KEY:      guavaKey,
    GUAVA_AGENT_NUMBER: guavaNum,
  }).catch((err: Error) => {
    ctx.emit({ type: "log", stage: "alert", message: `Call failed: ${err.message}` });
    return { outcome: "failed" as const, approved: null as boolean | null };
  });

  ctx.emit({ type: "log", stage: "alert", message: `Call outcome: ${callResult.outcome}` });
  if (callResult.approved === true)  ctx.emit({ type: "log", stage: "alert", message: "On-call engineer approved the fix PR" });
  if (callResult.approved === false) ctx.emit({ type: "log", stage: "alert", message: "On-call engineer rejected the fix PR" });

  // Mask number for safe logging (show last 4 digits only)
  const masked = toNumber.length > 4
    ? toNumber.slice(0, toNumber.length - 4).replace(/\d/g, "*") + toNumber.slice(-4)
    : "****";

  const data: AlertData = {
    skipped:   false,
    outcome:   callResult.outcome,
    approved:  callResult.approved,
    to_masked: masked,
    demo:      false,
  };
  ctx.emit({ type: "data", stage: "alert", data });

  return { status: "done", data, duration_ms: 0 };
}

// ── Expert subprocess helper ───────────────────────────────────────────────────

function spawnExpert(
  tsNodeBin: string,
  expertPath: string,
  env: Record<string, string>,
): Promise<{ outcome: string; approved: boolean | null }> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, [tsNodeBin, expertPath], {
      env:   { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Guava expert timed out after ${CALL_TIMEOUT_MS / 1000}s`));
    }, CALL_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      // Take the last non-empty line (ts-node may print startup noise before our JSON)
      const last = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
      try {
        const parsed = JSON.parse(last) as { outcome: string; approved: boolean | null };
        resolve(parsed);
      } catch {
        const msg = stderr.slice(0, 300) || `exit code ${code ?? "?"}`;
        reject(new Error(`Guava expert produced unexpected output: ${msg}`));
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export const alertStage: StageDef = { name: "alert", run };
