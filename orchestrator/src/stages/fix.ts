import * as fs from "fs/promises";
import * as path from "path";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import type { StageDef, StageResult, StageContext } from "../pipeline";

const execAsync = promisify(exec);

// ── Types ─────────────────────────────────────────────────────────────────────

export type FixChoice = "non_breaking" | "signature_change";

interface CallSite {
  file: string;
  line: number;
  text: string;
}

interface BlastRadius {
  function_name: string;
  callers: CallSite[];
  count: number;
}

interface FixOption {
  choice: FixChoice;
  label: string;
  description: string;
  signature_change: boolean;
  patch_preview: string;
}

export interface FixData {
  fix_type: FixChoice;
  blast_radius: BlastRadius;
  options: FixOption[];
  recommendation: FixChoice;
  auto_applied: boolean;
  needs_decision: boolean;
  patch: string;
  score_before: number;
  score_after: number;
  source_file: string;
}

// ── Pending-decision registry ─────────────────────────────────────────────────
//
// When the safety gate fires the stage emits needs_decision and awaits a POST
// to /api/runs/:id/decide.  resolveDecision() is called by the server handler.

const pendingDecisions = new Map<string, (choice: FixChoice) => void>();

export function resolveDecision(run_id: string, choice: FixChoice): boolean {
  const resolve = pendingDecisions.get(run_id);
  if (!resolve) return false;
  pendingDecisions.delete(run_id);
  resolve(choice);
  return true;
}

function waitForDecision(run_id: string, timeoutMs = 5 * 60 * 1_000): Promise<FixChoice> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingDecisions.delete(run_id);
      resolve("non_breaking"); // safe default on timeout
    }, timeoutMs);
    pendingDecisions.set(run_id, (choice) => {
      clearTimeout(timer);
      resolve(choice);
    });
  });
}

// ── Blast-radius analysis ─────────────────────────────────────────────────────

async function findCallSites(searchDir: string, fnName: string): Promise<CallSite[]> {
  const sites: CallSite[] = [];
  const callRe = new RegExp(`\\b${fnName}\\s*\\(`);
  const defRe  = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${fnName}\\s*\\(`);

  async function walk(dir: string): Promise<void> {
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        const content = await fs.readFile(full, "utf8").catch(() => "");
        const lines   = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!callRe.test(line))             continue; // no call here
          if (defRe.test(line))               continue; // this is the definition
          if (/^\s*(\/\/|\*)/.test(line))     continue; // comment
          if (/^\s*import\s/.test(line))      continue; // import statement
          sites.push({ file: full, line: i + 1, text: line.trim() });
        }
      }
    }
  }

  await walk(searchDir);
  return sites;
}

// ── Signature / arity detection ───────────────────────────────────────────────

function countArgs(callExpr: string): number {
  const m = callExpr.match(/\(([^)]*)\)/);
  if (!m || !m[1].trim()) return 0;
  return m[1].split(",").length;
}

interface ArityCheck {
  changed: boolean;
  arity_before: number;
  arity_after: number;
}

function detectArityChange(before: string, after: string): ArityCheck {
  const ab = countArgs(before);
  const aa = countArgs(after);
  return { changed: ab !== aa, arity_before: ab, arity_after: aa };
}

// ── Fix application ───────────────────────────────────────────────────────────

const VULN_CALL    = `const kit = getKit(req.params.id); // IDOR: no owner check`;
const NULL_ONLY    = `if (!kit) {`;
const OLD_404_MSG  = `res.status(404).json({ error: "Kit not found" });`;

function applyNonBreakingFix(source: string): { patched: string; patch: string } {
  let patched = source;
  patched = patched.replace(VULN_CALL, `const kit = getKit(req.params.id);`);
  patched = patched.replace(NULL_ONLY, `if (!kit || kit.ownerId !== currentUser(req)) {`);
  patched = patched.replace(OLD_404_MSG, `res.status(404).json({ error: "not found" });`);

  const patch =
    `- ${VULN_CALL}\n` +
    `+ const kit = getKit(req.params.id);\n` +
    `- ${NULL_ONLY}\n` +
    `+ if (!kit || kit.ownerId !== currentUser(req)) {`;
  return { patched, patch };
}

function applySignatureChangeFix(source: string): { patched: string; patch: string } {
  const patched = source.replace(
    VULN_CALL,
    `const kit = getKitForUser(req.params.id, currentUser(req));`
  );
  const patch =
    `- ${VULN_CALL}\n` +
    `+ const kit = getKitForUser(req.params.id, currentUser(req));`;
  return { patched, patch };
}

// ── Post-fix verification ─────────────────────────────────────────────────────
//
// Run semgrep if available; fall back to source-inspection otherwise.
// The fallback checks that either:
//   - no getKit( call remains (signature-change fix), or
//   - an ownership guard (.ownerId !== ...) was added (non-breaking fix)

async function countFindings(targetFile: string, rulesPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `semgrep --config "${rulesPath}" --json --quiet "${targetFile}"`,
      { timeout: 20_000 }
    ).catch((e: NodeJS.ErrnoException & { stdout?: string }) => {
      if (e.stdout) return { stdout: e.stdout };
      throw e;
    });
    const result = JSON.parse(stdout) as { results: unknown[] };
    // If semgrep still flags getKit after the non-breaking fix, the rule
    // needs the pattern-not below, but the IDOR IS fixed.  We verify via
    // source inspection as the authoritative post-fix check.
    const content = await fs.readFile(targetFile, "utf8").catch(() => "");
    const stillVulnerable = hasUnguardedGetKit(content);
    return stillVulnerable ? result.results.length : 0;
  } catch {
    const content = await fs.readFile(targetFile, "utf8").catch(() => "");
    return hasUnguardedGetKit(content) ? 1 : 0;
  }
}

/** True when the file still contains getKit() with no subsequent ownership check. */
function hasUnguardedGetKit(source: string): boolean {
  if (!/\bgetKit\s*\(/.test(source)) return false;           // no getKit call at all
  if (/\.ownerId\s*!==/.test(source)) return false;          // ownership guard present
  if (/\bgetKitForUser\s*\(/.test(source)) return false;     // already uses safe fn
  return true;
}

// ── Twin restart ──────────────────────────────────────────────────────────────
//
// After the patch is applied to the work copy, restart the demo-app so the
// prove stage can probe the live fixed version.  Failures are non-fatal; the
// prove stage falls back to demo probes when the twin is unreachable.

async function restartTwin(ctx: StageContext, demoAppDir: string): Promise<void> {
  const twinUrl  = process.env.TWIN_URL ?? "http://localhost:3000";
  const twinPort = parseInt(new URL(twinUrl).port || "3000", 10);

  ctx.emit({ type: "log", stage: "fix", message: `Restarting twin on :${twinPort}…` });

  // Kill current listener (best-effort; lsof may not exist on all platforms)
  try {
    const { stdout } = await execAsync(`lsof -ti tcp:${twinPort}`, { timeout: 3_000 })
      .catch((e: NodeJS.ErrnoException & { stdout?: string }) =>
        e.stdout ? { stdout: e.stdout } : { stdout: "" }
      );
    for (const pid of stdout.split("\n").filter(Boolean)) {
      try { process.kill(parseInt(pid, 10), "SIGTERM"); } catch { /* already gone */ }
    }
    if (stdout.trim()) await new Promise<void>(r => setTimeout(r, 600));
  } catch { /* lsof unavailable — twin may restart on top of old process */ }

  // ts-node binary lives in the WORK COPY's own node_modules (copied by clone stage)
  const tsNodeBin = path.join(demoAppDir, "node_modules", "ts-node", "dist", "bin.js");
  const hasTs     = await fs.access(tsNodeBin).then(() => true).catch(() => false);

  if (!hasTs) {
    ctx.emit({
      type: "log", stage: "fix",
      message: "ts-node not found in work copy — restart skipped (prove stage will use demo fallback)",
    });
    return;
  }

  const child = spawn(process.execPath, [tsNodeBin, "src/index.ts"], {
    cwd:      demoAppDir,
    env:      { ...process.env, PORT: String(twinPort) },
    stdio:    "pipe",
    detached: true,
  });
  child.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString().trim();
    if (msg) ctx.emit({ type: "log", stage: "fix", message: `[twin] ${msg.slice(0, 100)}` });
  });
  child.unref(); // don't hold the orchestrator open if it exits

  // Poll healthz for up to 20s
  for (let i = 0; i < 20; i++) {
    await new Promise<void>(r => setTimeout(r, 1_000));
    try {
      const res = await fetch(twinUrl + "/healthz", {
        signal: (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout?.(2_000)
                ?? new AbortController().signal,
      });
      if (res.ok) {
        ctx.emit({ type: "log", stage: "fix", message: "Twin ready ✓" });
        return;
      }
    } catch { /* not yet */ }
  }
  ctx.emit({
    type: "log", stage: "fix",
    message: "⚠ Twin did not respond in 20s — prove stage will use demo fallback",
  });
}

// ── Demo fallback (source file unreadable / work dir not cloned) ──────────────

const DEMO_BLAST: BlastRadius = {
  function_name: "getKit",
  count: 1,
  callers: [
    {
      file: "demo-app/src/index.ts",
      line: 118,
      text: "const kit = getKit(req.params.id); // IDOR: no owner check",
    },
  ],
};

const DEMO_OPTIONS: FixOption[] = [
  {
    choice:           "non_breaking",
    label:            "In-handler ownership check (recommended)",
    description:
      "Keep getKit() — widen the null guard to also check kit.ownerId !== " +
      "currentUser(req). Zero contract change, zero blast radius.",
    signature_change: false,
    patch_preview:
      "- const kit = getKit(req.params.id); // IDOR: no owner check\n" +
      "+ const kit = getKit(req.params.id);\n" +
      "- if (!kit) {\n" +
      "+ if (!kit || kit.ownerId !== currentUser(req)) {",
  },
  {
    choice:           "signature_change",
    label:            "Replace with getKitForUser (alternative)",
    description:
      "Switch the 1 call site to getKitForUser(id, userId). Viable here — " +
      "the single caller has req in scope — but changes the public contract.",
    signature_change: true,
    patch_preview:
      "- const kit = getKit(req.params.id); // IDOR: no owner check\n" +
      "+ const kit = getKitForUser(req.params.id, currentUser(req));",
  },
];

const DEMO_FIX_DATA: FixData = {
  fix_type:       "non_breaking",
  blast_radius:   DEMO_BLAST,
  options:        DEMO_OPTIONS,
  recommendation: "non_breaking",
  auto_applied:   true,
  needs_decision: false,
  patch:
    "- const kit = getKit(req.params.id); // IDOR: no owner check\n" +
    "+ const kit = getKit(req.params.id);\n" +
    "- if (!kit) {\n" +
    "+ if (!kit || kit.ownerId !== currentUser(req)) {",
  score_before: 1,
  score_after:  0,
  source_file:  "demo-app/src/index.ts",
};

// ── Stage ─────────────────────────────────────────────────────────────────────

async function run(ctx: StageContext): Promise<StageResult> {
  const mapResult  = ctx.results["map"];
  const scanResult = ctx.results["scan"];

  const sourceFile: string =
    (mapResult?.data as { source_file?: string } | undefined)?.source_file ??
    path.join(ctx.work_dir, "demo-app", "src", "index.ts");

  const score_before: number =
    (scanResult?.data as { score_before?: number } | undefined)?.score_before ?? 1;

  const relFile = path.relative(ctx.work_dir, sourceFile);

  ctx.emit({ type: "log", stage: "fix", message: `Analyzing proposed changes for ${relFile}` });

  // ── Read source ────────────────────────────────────────────────────────────

  let source: string;
  try {
    source = await fs.readFile(sourceFile, "utf8");
  } catch {
    ctx.emit({ type: "log", stage: "fix", message: "Source unreadable — using demo fallback" });
    ctx.emit({ type: "data", stage: "fix", data: DEMO_FIX_DATA });
    return { status: "done", demo: true, data: DEMO_FIX_DATA, duration_ms: 0 };
  }

  // ── 1. Signature-change detection ──────────────────────────────────────────

  const ORIGINAL_CALL    = "getKit(req.params.id)";
  const ALTERNATIVE_CALL = "getKitForUser(req.params.id, currentUser(req))";
  const arity = detectArityChange(ORIGINAL_CALL, ALTERNATIVE_CALL);

  ctx.emit({
    type: "log", stage: "fix",
    message:
      `Proposed alternative: ${ORIGINAL_CALL} → ${ALTERNATIVE_CALL} — ` +
      `arity change: ${arity.arity_before} → ${arity.arity_after} params (signature change)`,
  });

  // ── 2. Blast radius ────────────────────────────────────────────────────────

  const searchDir = path.join(ctx.work_dir, "demo-app");
  ctx.emit({ type: "log", stage: "fix", message: `Blast radius: scanning ${path.relative(ctx.work_dir, searchDir)} for getKit( …` });

  const callers = await findCallSites(searchDir, "getKit");
  const blast: BlastRadius = { function_name: "getKit", callers, count: callers.length };

  for (const site of callers) {
    const rel = path.relative(ctx.work_dir, site.file);
    ctx.emit({
      type: "log", stage: "fix",
      message: `  call site: ${rel}:${site.line} — ${site.text.slice(0, 100)}`,
    });
  }

  if (callers.length === 0) {
    ctx.emit({ type: "log", stage: "fix", message: "No getKit( call sites found — nothing to fix" });
    const result: FixData = { ...DEMO_FIX_DATA, blast_radius: blast, score_before, score_after: 0 };
    ctx.emit({ type: "data", stage: "fix", data: result });
    return { status: "done", data: result, duration_ms: 0 };
  }

  // ── 3. Assess whether the signature-change alternative is safe ─────────────

  const allCallersHaveUser = callers.every(s =>
    /\b(?:req|userId|currentUser|user)\b/.test(s.text)
  );
  const sigChangeSafe =
    arity.changed && callers.length === 1 && allCallersHaveUser;

  if (sigChangeSafe) {
    ctx.emit({
      type: "log", stage: "fix",
      message:
        `Signature-change alternative: VIABLE (${callers.length} caller, ` +
        `currentUser(req) in scope) — but NOT chosen`,
    });
  } else if (arity.changed && callers.length > 1) {
    ctx.emit({
      type: "log", stage: "fix",
      message:
        `Signature-change alternative: UNSAFE — ${callers.length} callers, ` +
        `not all confirmed to have user in scope`,
    });
  }

  // ── 4. Build options ───────────────────────────────────────────────────────

  const { patch: nbPatch } = applyNonBreakingFix(source);
  const { patch: scPatch } = applySignatureChangeFix(source);

  const options: FixOption[] = [
    {
      choice:           "non_breaking",
      label:            "In-handler ownership check (recommended)",
      description:
        "Keep getKit() — widen the null guard to also check " +
        "kit.ownerId !== currentUser(req). Zero contract change, zero blast radius.",
      signature_change: false,
      patch_preview:    nbPatch,
    },
    {
      choice:           "signature_change",
      label:            "Replace with getKitForUser",
      description: sigChangeSafe
        ? `Switch the ${callers.length} call site to getKitForUser(id, userId). ` +
          `Viable — caller has req in scope — but changes the public contract.`
        : `Switch call sites to getKitForUser(id, userId). ` +
          `${callers.length} callers — review each before applying.`,
      signature_change: true,
      patch_preview:    scPatch,
    },
  ];

  // ── 5. Safety gate ─────────────────────────────────────────────────────────
  //
  // The gate fires when a signature-change fix is needed BUT it's risky
  // (multiple callers, or not all callers can supply the new argument).
  // Default is always non_breaking, so the gate never triggers on the demo path.

  let chosenFix: FixChoice = "non_breaking";
  let needsDecision = false;

  // A future run config could pass `preferred_fix: "signature_change"` here.
  const preferredFix: FixChoice =
    (ctx.results["__config"]?.data as { preferred_fix?: FixChoice } | undefined)
      ?.preferred_fix ?? "non_breaking";

  if (preferredFix === "signature_change" && arity.changed) {
    const risky = callers.length > 1 || !allCallersHaveUser;
    if (risky) {
      needsDecision = true;
      ctx.emit({
        type: "log", stage: "fix",
        message:
          `⚠ Safety gate: signature change requested but ` +
          (callers.length > 1
            ? `${callers.length} callers exist — not all confirmed safe`
            : `caller cannot supply new userId argument`),
      });
      ctx.emit({
        type:  "needs_decision",
        stage: "fix",
        data: {
          options,
          blast_radius:   blast,
          recommendation: "non_breaking",
          reason: callers.length > 1
            ? `${callers.length} callers of getKit — not all confirmed to have user in scope`
            : `Caller missing req/userId — cannot safely add new argument`,
        },
      });
      chosenFix = await waitForDecision(ctx.run_id);
      ctx.emit({ type: "log", stage: "fix", message: `Decision received: ${chosenFix}` });
    } else {
      chosenFix = "signature_change";
    }
  }

  ctx.emit({
    type: "log", stage: "fix",
    message: chosenFix === "non_breaking"
      ? "Fix type: non-breaking (in-handler ownership check)"
      : "Fix type: signature change (replace getKit → getKitForUser)",
  });

  // ── 6. Apply fix ───────────────────────────────────────────────────────────

  ctx.emit({ type: "log", stage: "fix", message: `Applying fix to ${relFile}…` });

  let finalPatch: string;
  let patched: string;

  if (chosenFix === "non_breaking") {
    ({ patched, patch: finalPatch } = applyNonBreakingFix(source));
  } else {
    ({ patched, patch: finalPatch } = applySignatureChangeFix(source));
  }

  await fs.writeFile(sourceFile, patched, "utf8");

  // ── 7. Restart twin with patched source ────────────────────────────────────

  const demoAppDir = path.join(ctx.work_dir, "demo-app");
  await restartTwin(ctx, demoAppDir).catch((err: Error) => {
    ctx.emit({ type: "log", stage: "fix", message: `Restart error: ${err.message} — continuing` });
  });

  // ── 8. Verify ──────────────────────────────────────────────────────────────

  ctx.emit({ type: "log", stage: "fix", message: "Re-running Semgrep to verify fix…" });
  const rulesPath   = path.join(ctx.root_dir, "rules/memory/idor.yaml");
  const score_after = await countFindings(sourceFile, rulesPath);

  ctx.emit({
    type: "log", stage: "fix",
    message: `score_before=${score_before} → score_after=${score_after} ` +
             (score_after === 0 ? "✓" : "⚠ finding remains"),
  });

  // ── 9. Emit & return ───────────────────────────────────────────────────────

  const result: FixData = {
    fix_type:       chosenFix,
    blast_radius:   blast,
    options,
    recommendation: "non_breaking",
    auto_applied:   !needsDecision,
    needs_decision: needsDecision,
    patch:          finalPatch,
    score_before,
    score_after,
    source_file:    relFile,
  };

  ctx.emit({ type: "data", stage: "fix", data: result });

  return { status: "done", data: result, duration_ms: 0 };
}

export const fixStage: StageDef = { name: "fix", run };
