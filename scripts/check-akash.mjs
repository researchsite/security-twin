/**
 * scripts/check-akash.mjs — AkashML connectivity check
 *
 * Sends one chat completion and one tool-call to confirm the key + model work
 * before you flip LLM_PROVIDER=akash in the demo.
 *
 * Run from the repo root:
 *   node scripts/check-akash.mjs
 *
 * Reads AKASHML_API_KEY and ATTACKER_MODEL from ../.env.local (or environment).
 */

import OpenAI from "openai";
import { loadEnv, header, test, summary } from "./_env.mjs";

loadEnv();

const AKASH_BASE_URL = "https://api.akashml.com/v1";
const apiKey = process.env.AKASHML_API_KEY;
const model  = process.env.ATTACKER_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct";

header("AkashML connectivity check");
console.log(`  base_url : ${AKASH_BASE_URL}`);
console.log(`  model    : ${model}`);
console.log(`  key      : ${apiKey ? apiKey.slice(0, 8) + "…" : "(NOT SET)"}`);
console.log();

if (!apiKey) {
  console.error("✗  AKASHML_API_KEY is not set in .env.local — add it and retry.");
  process.exit(1);
}

const client = new OpenAI({ apiKey, baseURL: AKASH_BASE_URL });

let p = 0, f = 0, r;

// ── Test 1: basic chat completion ─────────────────────────────────────────────
r = await test("chat completion (1 message)", async () => {
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: 'Reply with exactly the word "OK" and nothing else.' }],
    max_tokens: 10,
  });
  const reply     = res.choices[0]?.message?.content?.trim() ?? "(empty)";
  const usedModel = res.model ?? model;
  return `model="${usedModel}"  reply="${reply}"`;
});
p += r.passed; f += r.failed;

// ── Test 2: tool-call support (required by the attacker agent) ────────────────
r = await test("tool-call support (function calling)", async () => {
  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: "Use the echo tool to echo 'hello'." }],
    tools: [{
      type: "function",
      function: {
        name:        "echo",
        description: "Echo a string back.",
        parameters:  { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    }],
    max_tokens: 60,
  });
  const choice      = res.choices[0];
  const toolCalls   = choice?.message?.tool_calls ?? [];
  const finishReason = choice?.finish_reason ?? "?";
  if (toolCalls.length === 0) throw new Error(`no tool_calls in response (finish_reason=${finishReason})`);
  return `finish_reason=${finishReason}  tool_calls=${toolCalls.length}`;
});
p += r.passed; f += r.failed;

summary("AkashML", p, f);

if (f > 0) process.exit(1);
