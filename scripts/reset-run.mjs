/**
 * scripts/reset-run.mjs  —  clean slate between pipeline runs
 *
 * Usage (from repo root):
 *   node scripts/reset-run.mjs [options]
 *
 * Options:
 *   --run-id <id>     target a specific run (default: all runs)
 *   --clear-mongo     also wipe runs/confessions/security_memory in MongoDB
 *                     (default: keep)
 *   --dry-run         print what would happen, touch nothing
 *
 * What it does:
 *   1. Deletes /tmp/runs/*  (or /tmp/runs/<run-id> if --run-id given)
 *   2. Deletes ClickHouse rows in requests / requests_per_second /
 *      requests_kit_enum for the target run-id  (TRUNCATE when --all)
 *   3. [opt] Deletes MongoDB docs from runs / confessions / security_memory
 */

import { createClient }                from "@clickhouse/client";
import { MongoClient }                 from "mongodb";
import { rmSync, readdirSync,
         existsSync, readFileSync }    from "fs";
import { resolve, dirname }            from "path";
import { fileURLToPath }               from "url";

// ── Load .env.local ───────────────────────────────────────────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const envPath = resolve(ROOT, ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (val && !process.env[key]) process.env[key] = val;
  }
} else {
  console.warn(`  ⚠  .env.local not found at ${envPath} — using process.env only`);
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const runIdIdx   = args.indexOf("--run-id");
const runId      = runIdIdx !== -1 ? (args[runIdIdx + 1] ?? null) : null;
const clearMongo = args.includes("--clear-mongo");
const dryRun     = args.includes("--dry-run");

const LINE = "━".repeat(62);

console.log(`\n${LINE}`);
console.log(`  Security Twin — reset-run`);
console.log(LINE);
console.log(`  target   : ${runId ?? "ALL runs"}`);
console.log(`  mongo    : ${clearMongo ? "CLEAR  (runs + confessions + security_memory)" : "keep  (pass --clear-mongo to wipe)"}`);
console.log(`  dry-run  : ${dryRun ? "YES — nothing will be touched" : "no"}`);
console.log(LINE + "\n");

let passed = 0;
let failed = 0;

async function step(label, fn) {
  process.stdout.write(`  ${label.padEnd(52)} `);
  const t = Date.now();
  try {
    const note = await fn();
    const ms = Date.now() - t;
    console.log(`✓  (${ms}ms)${note ? `  ${note}` : ""}`);
    passed++;
  } catch (err) {
    console.log(`✗`);
    console.error(`     └─ ${err.message}`);
    failed++;
  }
}

// ── 1. /tmp/runs workspaces ───────────────────────────────────────────────────

const TMP_RUNS = "/tmp/runs";

await step(`Delete ${runId ? `${TMP_RUNS}/${runId}` : `${TMP_RUNS}/*`}`, async () => {
  if (!existsSync(TMP_RUNS)) return "no /tmp/runs directory";

  const targets = runId
    ? [`${TMP_RUNS}/${runId}`]
    : readdirSync(TMP_RUNS, { withFileTypes: true })
        .map(e => `${TMP_RUNS}/${e.name}`);

  const found = targets.filter(p => existsSync(p));
  if (found.length === 0) return "nothing found";
  if (dryRun)             return `dry-run: would remove ${found.join(", ")}`;

  for (const p of found) rmSync(p, { recursive: true, force: true });
  return `removed ${found.length} dir${found.length !== 1 ? "s" : ""}`;
});

// ── 2. ClickHouse ─────────────────────────────────────────────────────────────

const CH_TABLES = [
  "requests",
  "requests_per_second",
  "requests_kit_enum",
];

const chUrl  = process.env.CLICKHOUSE_URL;
const chUser = process.env.CLICKHOUSE_USER     ?? "default";
const chPass = process.env.CLICKHOUSE_PASSWORD ?? "";

if (!chUrl) {
  console.log(`  ClickHouse                                              — skipped (CLICKHOUSE_URL not set)`);
} else {
  const ch = createClient({ url: chUrl, username: chUser, password: chPass });

  for (const table of CH_TABLES) {
    const label = runId
      ? `CH: DELETE FROM ${table} WHERE run_id='${runId}'`
      : `CH: TRUNCATE ${table}`;

    await step(label, async () => {
      if (dryRun) return "dry-run";

      if (runId) {
        // Lightweight mutation — synchronous so we can verify immediately
        await ch.command({
          query:  `ALTER TABLE ${table} DELETE WHERE run_id = {run_id: String}`,
          query_params:          { run_id: runId },
          clickhouse_settings:   { mutations_sync: "1" },
        });
        const rs   = await ch.query({
          query:        `SELECT count() AS n FROM ${table} WHERE run_id = {run_id: String}`,
          format:       "JSONEachRow",
          query_params: { run_id: runId },
        });
        const rows = await rs.json();
        const n    = Number(rows[0]?.n ?? -1);
        return n === 0 ? "rows = 0 ✓" : `⚠ ${n} row${n !== 1 ? "s" : ""} remain`;
      } else {
        await ch.command({ query: `TRUNCATE TABLE IF EXISTS ${table}` });
        return "truncated";
      }
    });
  }

  await ch.close();
}

// ── 3. MongoDB (optional, gated by --clear-mongo) ─────────────────────────────

if (!clearMongo) {
  console.log(`  MongoDB                                                 — kept  (pass --clear-mongo to wipe)`);
} else {
  const mongoUrl = process.env.MONGODB_URI ?? process.env.MONGODB_URL;
  const mongoDB  = process.env.MONGODB_DB ?? "security_twin";

  if (!mongoUrl) {
    console.log(`  MongoDB                                                 — skipped (MONGODB_URI not set)`);
  } else {
    const mc = new MongoClient(mongoUrl);
    await mc.connect();
    const db = mc.db(mongoDB);

    // runs and confessions are scoped to run_id; security_memory is global
    for (const coll of ["runs", "confessions"]) {
      const filter = runId ? { run_id: runId } : {};
      const label  = runId
        ? `MongoDB: ${coll}.deleteMany({run_id:'${runId}'})`
        : `MongoDB: ${coll}.deleteMany({})`;

      await step(label, async () => {
        if (dryRun) return "dry-run";
        const r = await db.collection(coll).deleteMany(filter);
        return `deleted ${r.deletedCount} doc${r.deletedCount !== 1 ? "s" : ""}`;
      });
    }

    // security_memory uses bug-class IDs (SEC-001, …), not run_id.
    // Only wipe on --all (no --run-id) to avoid nuking the knowledge base per-run.
    if (!runId) {
      await step("MongoDB: security_memory.deleteMany({})", async () => {
        if (dryRun) return "dry-run";
        const r = await db.collection("security_memory").deleteMany({});
        return `deleted ${r.deletedCount} doc${r.deletedCount !== 1 ? "s" : ""}`;
      });
    } else {
      console.log(`  MongoDB: security_memory                                — kept (not scoped to a single run_id)`);
    }

    await mc.close();
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${LINE}`);
if (failed === 0) {
  console.log(`  ✓  ${passed} step${passed !== 1 ? "s" : ""} completed — ready for next run`);
} else {
  console.log(`  ${passed} passed  /  ${failed} FAILED`);
  console.log(`  Check CLICKHOUSE_URL / MONGODB_URI in .env.local`);
}
console.log(`${LINE}\n`);

if (failed > 0) process.exit(1);
