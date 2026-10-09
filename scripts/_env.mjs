/**
 * Shared .env.local loader for test scripts.
 * Reads ../.env.local relative to this file and populates process.env.
 * Values already set in the environment take precedence.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

export function loadEnv(envFile = "../.env.local") {
  const envPath = resolve(__dir, envFile);
  try {
    const raw = readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (val && !process.env[key]) process.env[key] = val;
    }
  } catch {
    console.warn(`⚠  Could not read ${envPath}`);
  }
}

/** Print a section header */
export function header(title) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  ${title}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

/** Run a named test step. Returns { passed, failed } delta. */
export async function test(name, fn) {
  process.stdout.write(`  ${name.padEnd(38)} `);
  const t = Date.now();
  try {
    const note = await fn();
    const ms = Date.now() - t;
    console.log(`✓  (${ms}ms)${note ? "  " + note : ""}`);
    return { passed: 1, failed: 0 };
  } catch (err) {
    console.log(`✗`);
    console.error(`     └─ ${err.message}`);
    return { passed: 0, failed: 1 };
  }
}

export function summary(label, passed, failed) {
  console.log(`\n  ${label}: ${passed} passed  /  ${failed > 0 ? failed + " FAILED" : "0 failed"}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}
