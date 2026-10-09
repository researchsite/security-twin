/**
 * ClickHouse connectivity test
 * Run from: security-twin/scripts/
 *   npm install
 *   node test-clickhouse.mjs
 *
 * Reads CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD from ../.env.local
 */

import { createClient } from "@clickhouse/client";
import { loadEnv, header, test as runTest, summary } from "./_env.mjs";

loadEnv();

// ── Config ────────────────────────────────────────────────────────────────────

const url      = process.env.CLICKHOUSE_URL;
const username = process.env.CLICKHOUSE_USER      ?? "default";
const password = process.env.CLICKHOUSE_PASSWORD  ?? "";

if (!url) {
  console.error("✗  CLICKHOUSE_URL is not set in .env.local");
  process.exit(1);
}

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("  ClickHouse connectivity test");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`  URL  : ${url}`);
console.log(`  User : ${username}`);
console.log(`  Pass : ${"*".repeat(password.length)}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

const client = createClient({ url, username, password });

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  process.stdout.write(`  ${name} … `);
  const t = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t;
    console.log(`✓  (${ms}ms)${result ? "  " + result : ""}`);
    passed++;
  } catch (err) {
    console.log(`✗`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// 1. Ping — simplest possible query
await test("Ping (SELECT 1)", async () => {
  const rs = await client.query({ query: "SELECT 1 AS n", format: "JSONEachRow" });
  const rows = await rs.json();
  if (rows[0]?.n !== 1) throw new Error(`Unexpected result: ${JSON.stringify(rows)}`);
});

// 2. Server version
await test("Server version", async () => {
  const rs = await client.query({ query: "SELECT version() AS v", format: "JSONEachRow" });
  const rows = await rs.json();
  return rows[0]?.v ?? "unknown";
});

// 3. Current database
await test("Current database", async () => {
  const rs = await client.query({ query: "SELECT currentDatabase() AS db", format: "JSONEachRow" });
  const rows = await rs.json();
  return rows[0]?.db ?? "unknown";
});

// 4. Create a scratch table
const TABLE = "security_twin_conn_test";
await test("Create test table", async () => {
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        id   UInt32,
        msg  String,
        ts   DateTime DEFAULT now()
      )
      ENGINE = MergeTree()
      ORDER BY id
    `,
  });
});

// 5. Insert a row
await test("Insert row", async () => {
  await client.insert({
    table: TABLE,
    values: [{ id: 1, msg: "security-twin test" }],
    format: "JSONEachRow",
  });
});

// 6. Read it back
await test("Query row back", async () => {
  const rs = await client.query({
    query: `SELECT id, msg FROM ${TABLE} WHERE id = 1 LIMIT 1`,
    format: "JSONEachRow",
  });
  const rows = await rs.json();
  if (!rows.length) throw new Error("Row not found");
  if (rows[0].msg !== "security-twin test") throw new Error(`Wrong value: ${rows[0].msg}`);
  return `id=${rows[0].id} msg="${rows[0].msg}"`;
});

// 7. Drop scratch table
await test("Drop test table", async () => {
  await client.command({ query: `DROP TABLE IF EXISTS ${TABLE}` });
});

// ── Summary ───────────────────────────────────────────────────────────────────

await client.close();

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
if (failed === 0) {
  console.log(`  ✓  All ${passed} tests passed — ClickHouse is ready`);
} else {
  console.log(`  ${passed} passed  /  ${failed} FAILED`);
}
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

if (failed > 0) process.exit(1);
