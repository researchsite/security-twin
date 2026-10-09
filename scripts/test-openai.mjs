import OpenAI from "openai";
import { loadEnv, header, test, summary } from "./_env.mjs";

loadEnv();

const apiKey = process.env.OPENAI_API_KEY;

header("OpenAI connectivity test");

if (!apiKey) {
  console.error("  ✗  OPENAI_API_KEY not set in .env.local");
  process.exit(1);
}

console.log(`  Key : sk-...${apiKey.slice(-6)}\n`);

const openai = new OpenAI({ apiKey });
let passed = 0, failed = 0;

function tally(r) { passed += r.passed; failed += r.failed; }

// 1. List models (lightweight auth check)
tally(await test("List models (auth check)", async () => {
  const page = await openai.models.list();
  const models = page.data ?? [];
  if (!models.length) throw new Error("No models returned");
  return `${models.length} models available`;
}));

// 2. Simple chat completion — cheapest model
tally(await test("Chat completion (gpt-4.1-nano)", async () => {
  const res = await openai.chat.completions.create({
    model:      "gpt-4.1-nano",
    messages:   [{ role: "user", content: 'Reply with exactly the word "pong".' }],
    max_tokens: 5,
    temperature: 0,
  });
  const text = res.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
  if (!text.includes("pong")) throw new Error(`Unexpected reply: "${text}"`);
  return `reply="${text}"  tokens=${res.usage?.total_tokens ?? "?"}`;
}));

// 3. Embeddings
tally(await test("Embedding (text-embedding-3-small)", async () => {
  const res = await openai.embeddings.create({
    model:  "text-embedding-3-small",
    input:  "security twin test",
  });
  const dim = res.data[0]?.embedding?.length ?? 0;
  if (dim === 0) throw new Error("Empty embedding");
  return `dim=${dim}`;
}));

summary("OpenAI", passed, failed);
if (failed > 0) process.exit(1);
