import "dotenv/config";
import OpenAI from "openai";
import { generatePayloads } from "./payloads";
import type { AttackCategory } from "../../orchestrator/src/types";

const SHIELD_URL = process.env.SHIELD_URL ?? "http://localhost:4000";
const TARGET_PATHS = ["/api/kits", "/api/process", "/api/user", "/search", "/health"];

const CATEGORIES: AttackCategory[] = [
  "sql_injection",
  "xss",
  "path_traversal",
  "idor",
  "auth_bypass",
  "ssrf",
  "command_injection",
  "header_injection",
  "open_redirect",
  "mass_assignment",
];

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function run() {
  console.log(`[ATTACKER] Starting attack run against ${SHIELD_URL}`);

  for (const category of CATEGORIES) {
    const payloads = await generatePayloads(openai, category);
    for (const payload of payloads) {
      const path = TARGET_PATHS[Math.floor(Math.random() * TARGET_PATHS.length)];
      const start = Date.now();
      try {
        const resp = await fetch(`${SHIELD_URL}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Attacker": "security-twin",
          },
          body: JSON.stringify({ input: payload }),
        });
        const duration = Date.now() - start;
        const status = resp.status;
        const outcome = status === 403 ? "blocked" : "passed";
        console.log(`[ATTACKER] ${category.padEnd(20)} ${outcome.padEnd(8)} ${status} ${path} (${duration}ms)`);
      } catch (err) {
        console.error(`[ATTACKER] ${category} ERROR: ${(err as Error).message}`);
      }
    }
  }

  console.log("[ATTACKER] Run complete.");
}

run().catch(console.error);
