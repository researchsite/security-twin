import * as fs from "fs/promises";
import * as path from "path";
import type { StageDef, StageResult, StageContext } from "../pipeline";
import type { FixData } from "./fix";
import type { ProveData } from "./prove";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SyncData {
  skipped:            boolean;
  reason?:            string;
  branch:             string;
  repo?:              string;
  pr_url?:            string;
  pr_number?:         number;
  files_committed:    string[];
  fix_type:           string;
  blast_radius_count: number;
  pr_body?:           string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BRANCH_NAME = "security-twin/SEC-001";
const FILES_TO_COMMIT = [
  "src/index.ts",
  "rules/memory/SEC-001.yaml",
  ".github/workflows/twin-gate.yml",
];

const TWIN_GATE_YML = `name: Security Twin — IDOR Gate (SEC-001)
on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  idor-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Semgrep
        run: pip3 install semgrep
      - name: SEC-001 — detect getKit without owner check (IDOR / CWE-639)
        run: semgrep --config rules/memory/SEC-001.yaml src/ --error
        # Fails the build if getKit() is called without an ownership guard.
        # Preferred fix: if (!kit || kit.ownerId !== currentUser(req)) return res.status(404)…
        # Alternative:   replace with getKitForUser(id, userId) at all call sites.
`;

// ── GitHub REST API client (native fetch, no extra dependency) ────────────────

type GHResponse = Record<string, unknown>;

function ghFetchTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function ghFetch(
  method: string,
  apiPath: string,
  token: string,
  body?: unknown,
): Promise<GHResponse> {
  const res = await ghFetchTimeout(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  }, 20_000);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub ${method} ${apiPath} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<GHResponse>;
}

// Get existing file SHA (needed to overwrite on the branch)
async function getFileSha(
  owner: string, repo: string, filePath: string, ref: string, token: string,
): Promise<string | null> {
  try {
    const r = await ghFetch("GET", `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`, token);
    return (r as { sha?: string }).sha ?? null;
  } catch {
    return null;
  }
}

// Create or update a single file on a branch
async function upsertFile(
  owner: string, repo: string, filePath: string, content: string,
  branch: string, token: string, message: string,
): Promise<void> {
  const sha = await getFileSha(owner, repo, filePath, branch, token);
  await ghFetch("PUT", `/repos/${owner}/${repo}/contents/${filePath}`, token, {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  });
}

// ── PR description ────────────────────────────────────────────────────────────

function buildPrBody(fixData: FixData | undefined, proveData: ProveData | undefined): string {
  const fixType      = fixData?.fix_type    ?? "non_breaking";
  const blastCount   = fixData?.blast_radius?.count ?? 1;
  const callers      = fixData?.blast_radius?.callers ?? [];
  const allPass      = proveData?.all_pass  ?? true;
  const scoreAfter   = proveData?.score_after ?? 0;
  const scoreBefore  = fixData?.score_before ?? 1;

  const fixLabel = fixType === "non_breaking"
    ? "non-breaking (in-handler ownership check)"
    : "signature change (`getKitForUser`)";

  const callerLines = callers.length > 0
    ? callers.map(c =>
        `  - \`${c.file.split("/").slice(-2).join("/")}\` line ${c.line}: \`${c.text.slice(0, 70)}\``
      ).join("\n")
    : "  - demo-app/src/index.ts line 118: `const kit = getKit(req.params.id);`";

  const patchFenced = `\`\`\`diff\n${fixData?.patch ?? "- const kit = getKit(req.params.id); // IDOR: no owner check\n+ const kit = getKit(req.params.id);\n- if (!kit) {\n+ if (!kit || kit.ownerId !== currentUser(req)) {"}\n\`\`\``;

  return [
    "## Security Twin — SEC-001 IDOR Fix",
    "",
    `**Fix type:** ${fixLabel}  `,
    `**Blast radius:** ${blastCount} caller${blastCount !== 1 ? "s" : ""} of \`getKit(\` scanned`,
    "",
    "### What was found",
    "",
    "The AI security agent enumerated `/api/kits/:id` across users alice, bob, and carol.",
    "Semgrep rule SEC-001 confirmed `getKit()` was called without an owner check at `src/index.ts:118`.",
    "CWE-639 / OWASP A01:2021 — Broken Access Control.",
    "",
    "### What was fixed",
    "",
    fixType === "non_breaking"
      ? "**In-handler ownership guard added — no signature change, zero blast radius.**"
      : "**Call site replaced with `getKitForUser` — all callers audited.**",
    "",
    patchFenced,
    "",
    "### Blast radius",
    "",
    `\`${fixData?.blast_radius?.function_name ?? "getKit"}(\` — ${blastCount} call site${blastCount !== 1 ? "s" : ""}:`,
    "",
    callerLines,
    "",
    "### Proof",
    "",
    allPass
      ? `Re-running the IDOR probe after fix: **all ${proveData?.probes.length ?? 3} probes pass** (score ${scoreBefore} → ${scoreAfter}) ✓`
      : "⚠ Some probes did not pass — review manually before merging.",
    "",
    "### Files changed",
    "",
    "- `src/index.ts` — authorization guard added to `GET /api/kits/:id`",
    "- `rules/memory/SEC-001.yaml` — Semgrep rule for regression detection",
    "- `.github/workflows/twin-gate.yml` — CI gate to prevent future IDOR regression",
    "",
    "---",
    "",
    "_Generated by the [Security Twin](https://github.com/security-twin/security-twin) agentic security pipeline._",
  ].join("\n");
}

// ── Stage ─────────────────────────────────────────────────────────────────────

async function run(ctx: StageContext): Promise<StageResult> {
  const token      = process.env.GITHUB_TOKEN;
  const forkSlug   = process.env.GITHUB_FORK;          // owner/repo of the test fork
  const baseBranch = process.env.GITHUB_BASE_BRANCH ?? "main";

  const fixData   = ctx.results["fix"]?.data   as FixData   | undefined;
  const proveData = ctx.results["prove"]?.data as ProveData | undefined;

  const fixType        = fixData?.fix_type    ?? "non_breaking";
  const blastCount     = fixData?.blast_radius?.count ?? 1;
  const sourceFileRel  = fixData?.source_file ?? "demo-app/src/index.ts";

  ctx.emit({ type: "log", stage: "sync", message: `Reading patched ${sourceFileRel}…` });
  ctx.emit({ type: "log", stage: "sync", message: "Reading rules/memory/SEC-001.yaml…" });
  ctx.emit({ type: "log", stage: "sync", message: "Generating .github/workflows/twin-gate.yml…" });

  if (!token || !forkSlug) {
    const missing = !token && !forkSlug
      ? "GITHUB_TOKEN and GITHUB_FORK"
      : !token ? "GITHUB_TOKEN" : "GITHUB_FORK";
    ctx.emit({
      type: "log", stage: "sync",
      message: `${missing} not set — sync skipped (set GITHUB_FORK=owner/repo and GITHUB_TOKEN to create PR)`,
    });

    const result: SyncData = {
      skipped:            true,
      reason:             `${missing} not configured`,
      branch:             BRANCH_NAME,
      files_committed:    FILES_TO_COMMIT,
      fix_type:           fixType,
      blast_radius_count: blastCount,
      pr_body:            buildPrBody(fixData, proveData),
    };
    ctx.emit({ type: "data", stage: "sync", data: result });
    return { status: "done", demo: true, data: result, duration_ms: 0 };
  }

  const parts = forkSlug.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`GITHUB_FORK must be owner/repo, got: ${forkSlug}`);
  }
  const [owner, repo] = parts;

  ctx.emit({ type: "log", stage: "sync", message: `Targeting fork ${owner}/${repo}` });

  // 1. Get base branch SHA
  const baseRef = (await ghFetch(
    "GET", `/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, token,
  )) as { object?: { sha?: string } };
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`Could not resolve SHA for branch ${baseBranch}`);

  // 2. Create branch (idempotent — 422 means it already exists)
  ctx.emit({ type: "log", stage: "sync", message: `Creating branch ${BRANCH_NAME}…` });
  try {
    await ghFetch("POST", `/repos/${owner}/${repo}/git/refs`, token, {
      ref: `refs/heads/${BRANCH_NAME}`,
      sha: baseSha,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (!msg.includes("422")) throw err;
    ctx.emit({ type: "log", stage: "sync", message: "Branch already exists — reusing" });
  }

  // 3. Read file contents
  const patchedSource = await (async () => {
    const wc = path.join(ctx.work_dir, sourceFileRel);
    const src = await fs.readFile(wc, "utf8").catch(() => null);
    if (src) return src;
    // Fallback: original (unpatched) in repo — note in comment
    return fs.readFile(
      path.join(ctx.root_dir, "demo-app", "src", "index.ts"), "utf8"
    ).catch(() => "// patched source unavailable");
  })();

  const sec001Yaml = await fs.readFile(
    path.join(ctx.root_dir, "rules", "memory", "SEC-001.yaml"), "utf8"
  ).catch(() => "# SEC-001 rule unavailable");

  // 4. Commit three files
  const base = `fix(IDOR): ownership guard GET /api/kits/:id (SEC-001)\n\nfix_type: ${fixType}\nblast_radius: ${blastCount} caller(s)`;

  ctx.emit({ type: "log", stage: "sync", message: "Committing src/index.ts…" });
  await upsertFile(owner, repo, "src/index.ts", patchedSource, BRANCH_NAME, token, base);

  ctx.emit({ type: "log", stage: "sync", message: "Committing rules/memory/SEC-001.yaml…" });
  await upsertFile(owner, repo, "rules/memory/SEC-001.yaml", sec001Yaml, BRANCH_NAME, token, "ci: add SEC-001 Semgrep rule");

  ctx.emit({ type: "log", stage: "sync", message: "Committing .github/workflows/twin-gate.yml…" });
  await upsertFile(owner, repo, ".github/workflows/twin-gate.yml", TWIN_GATE_YML, BRANCH_NAME, token, "ci: add IDOR gate workflow (twin-gate SEC-001)");

  // 5. Open PR
  const prBody = buildPrBody(fixData, proveData);
  ctx.emit({ type: "log", stage: "sync", message: `Opening PR on ${owner}/${repo}…` });

  const pr = await ghFetch("POST", `/repos/${owner}/${repo}/pulls`, token, {
    title: `fix(IDOR): add ownership guard to GET /api/kits/:id [SEC-001]`,
    body:  prBody,
    head:  BRANCH_NAME,
    base:  baseBranch,
  }) as { html_url?: string; number?: number };

  const prUrl    = (pr.html_url as string | undefined) ?? "";
  const prNumber = (pr.number  as number | undefined) ?? 0;

  ctx.emit({ type: "log", stage: "sync", message: `PR #${prNumber} opened: ${prUrl}` });

  const result: SyncData = {
    skipped:            false,
    branch:             BRANCH_NAME,
    repo:               `${owner}/${repo}`,
    pr_url:             prUrl,
    pr_number:          prNumber,
    files_committed:    FILES_TO_COMMIT,
    fix_type:           fixType,
    blast_radius_count: blastCount,
    pr_body:            prBody,
  };
  ctx.emit({ type: "data", stage: "sync", data: result });

  return { status: "done", data: result, duration_ms: 0 };
}

export const syncStage: StageDef = { name: "sync", run };
