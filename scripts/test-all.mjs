/**
 * Run every connectivity test in sequence and print a consolidated report.
 * Usage:  node test-all.mjs
 */
import { spawnSync } from "child_process";
import { loadEnv } from "./_env.mjs";

loadEnv();

const TESTS = [
  { name: "ClickHouse", script: "test-clickhouse.mjs", key: "CLICKHOUSE_URL" },
  { name: "MongoDB",    script: "test-mongodb.mjs",    key: "MONGODB_URI" },
  { name: "OpenAI",     script: "test-openai.mjs",     key: "OPENAI_API_KEY" },
  { name: "GitHub",     script: "test-github.mjs",     key: "GITHUB_TOKEN" },
];

console.log("\n╔══════════════════════════════════════════════════════════╗");
console.log("║           security-twin — all integrations test          ║");
console.log("╚══════════════════════════════════════════════════════════╝");

const results = [];

for (const { name, script, key } of TESTS) {
  if (!process.env[key]) {
    console.log(`\n  ⊘  ${name} — skipped (${key} not set)`);
    results.push({ name, status: "skipped" });
    continue;
  }

  console.log(`\n  ▶  Running ${name} tests…`);
  const r = spawnSync("node", [script], {
    stdio: "inherit",
    cwd: new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
  });

  results.push({
    name,
    status: r.status === 0 ? "passed" : "FAILED",
  });
}

// ── Final summary ─────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════════╗");
console.log("║                     Final summary                        ║");
console.log("╠══════════════════════════════════════════════════════════╣");

let anyFailed = false;
for (const { name, status } of results) {
  const icon   = status === "passed" ? "✓" : status === "skipped" ? "⊘" : "✗";
  const colour = status === "FAILED" ? " ← FAILED" : "";
  console.log(`║  ${icon}  ${name.padEnd(20)} ${status.padEnd(8)}${colour.padEnd(18)}║`);
  if (status === "FAILED") anyFailed = true;
}

console.log("╚══════════════════════════════════════════════════════════╝\n");

process.exit(anyFailed ? 1 : 0);
