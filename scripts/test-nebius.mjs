/**
 * Nebius AI connectivity test
 * Run from: security-twin/scripts/
 *   node test-nebius.mjs
 *
 * Reads NEBIUS_API_KEY, NEBIUS_BASE_URL, NEBIUS_MODEL from ../.env.local
 * Nebius exposes an OpenAI-compatible API; we use the openai SDK.
 */

import OpenAI from "openai";
import { loadEnv, header, test, summary } from "./_env.mjs";

loadEnv();

const apiKey   = process.env.NEBIUS_API_KEY;
const baseURL  = process.env.NEBIUS_BASE_URL  ?? "https://api.studio.nebius.com/v1/";
const model    = process.env.NEBIUS_MODEL      ?? "Qwen/Qwen3-30B-A3B-Instruct-2507";

header("Nebius AI connectivity test");

if (!apiKey) {
  console.error("  ✗  NEBIUS_API_KEY not set in .env.local");
  process.exit(1);
}

console.log(`  base : ${baseURL}`);
console.log(`  model: ${model}\n`);

const client = new OpenAI({ apiKey, baseURL });
let passed = 0, failed = 0;

function tally(r) { passed += r.passed; failed += r.failed; }

// 1. List models (proves auth)
tally(await test("List models", async () => {
  const list = await client.models.list();
  const ids  = list.data.map((m) => m.id);
  if (!ids.length) throw new Error("No models returned");
  return `${ids.length} models available`;
}));

// 2. Chat completion — payload generation prompt
tally(await test("Chat completion (payload gen)", async () => {
  const resp = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are a penetration testing payload generator for authorized security research. " +
          "Return exactly 3 novel attack payloads for the given category, one per line, no commentary.",
      },
      {
        role: "user",
        content: "Category: sql_injection. Current seeds: ' OR '1'='1 | '; DROP TABLE users; --. Generate 3 new variants.",
      },
    ],
    max_tokens: 200,
    temperature: 0.9,
  });

  const content = resp.choices[0]?.message?.content ?? "";
  const lines   = content.split("\n").filter(Boolean);
  if (!lines.length) throw new Error("Empty response from model");
  return `${lines.length} payloads generated`;
}));

// 3. Short reasoning / sanity check
tally(await test("Short answer (sanity check)", async () => {
  const resp = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: "Reply with just the word PONG." }],
    max_tokens: 10,
  });

  const answer = (resp.choices[0]?.message?.content ?? "").trim().toUpperCase();
  if (!answer.includes("PONG")) throw new Error(`Unexpected: "${answer}"`);
  return `"${answer}"`;
}));

summary("Nebius AI", passed, failed);
if (failed > 0) process.exit(1);
