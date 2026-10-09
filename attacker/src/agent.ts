/**
 * agent.ts — Authorized AI security-testing agent for the demo-app.
 *
 * Reaches the target ONLY through the shield (SHIELD_URL env).
 * The host check is enforced in code, not just in the prompt.
 *
 * Usage:
 *   ts-node src/agent.ts              # live run
 *   ts-node src/agent.ts --dry        # replay recordings/sample-run.json
 *   ts-node src/agent.ts --record     # live run + save to recordings/sample-run.json
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import type { ChatCompletionTool, ChatCompletionMessageParam } from "openai/resources";

// ── Config ─────────────────────────────────────────────────────────────────────

const SHIELD_URL   = (process.env.SHIELD_URL       ?? "http://localhost:8080").replace(/\/$/, "");
const ORCH_URL     = (process.env.ORCHESTRATOR_URL ?? "http://localhost:4001").replace(/\/$/, "");
const RUN_ID       = process.env.RUN_ID ?? `agent-${Date.now()}`;
const MODEL        = process.env.ATTACKER_MODEL ?? "gpt-4o";
const BASE_URL     = process.env.ATTACKER_BASE_URL;             // AkashML / Nebius / etc.
const API_KEY      =
  process.env.ATTACKER_API_KEY ??
  process.env.AKASHML_API_KEY  ??
  process.env.OPENAI_API_KEY   ??
  "";

const MAX_REQUESTS = 40;   // hard budget per run
const RATE_MS      = 300;  // minimum ms between HTTP calls

const RECORDINGS_DIR = path.join(__dirname, "..", "recordings");
const SAMPLE_FILE    = path.join(RECORDINGS_DIR, "sample-run.json");

// ── CLI ────────────────────────────────────────────────────────────────────────

const argv   = process.argv.slice(2);
const DRY    = argv.includes("--dry");
const RECORD = argv.includes("--record");

// ── OpenAI client (lazy) ───────────────────────────────────────────────────────
// Deferred so --dry mode never instantiates the client (openai v7 throws
// immediately on construction when apiKey is blank).

let _client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!_client) {
    if (!API_KEY) {
      throw new Error(
        "No API key found. Set ATTACKER_API_KEY (or OPENAI_API_KEY / AKASHML_API_KEY) in .env.local"
      );
    }
    _client = new OpenAI({ apiKey: API_KEY, ...(BASE_URL ? { baseURL: BASE_URL } : {}) });
  }
  return _client;
}

// Native OpenAI: use the Responses API (stateful, previous_response_id).
// Any custom base URL (AkashML, Nebius, etc.) only speaks Chat Completions.
const USE_RESPONSES = !BASE_URL; // verified at runtime inside runWithResponsesApi()

// ── Prompts & tools ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  `You are a web security tester assessing a demo app you are authorized to test at ${SHIELD_URL}.`,
  "Find access-control weaknesses. Read robots.txt and page source for hints. Report what you find.",
  "",
  "Strategy:",
  "1. Fetch /robots.txt — note disallowed paths.",
  "2. Enumerate users via /api/users.",
  "3. Fetch /api/kits as each user (use x-demo-user header). Note kit IDs.",
  "4. Attempt IDOR: request kit IDs owned by user B while authenticated as user A.",
  "5. Note any paths that return data they should not.",
  "6. When done, write a concise findings report.",
].join("\n");

// Responses API tool format (flat, no .function wrapper)
const RESP_TOOL = {
  type: "function" as const,
  name: "http_request",
  description:
    "Make an HTTP request to the security test target. " +
    `ONLY ${SHIELD_URL} is permitted — any other host is refused in code.`,
  parameters: {
    type: "object",
    properties: {
      method:  { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"] },
      path:    { type: "string", description: "URL path like /api/kits/1 (or full URL matching shield host)." },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Extra request headers. Use x-demo-user to change the simulated user.",
      },
      body: { type: "string", description: "Request body as a plain JSON string." },
    },
    required: ["method", "path"],
  },
};

// Chat Completions tool format (nested under .function)
const CC_TOOL: ChatCompletionTool = {
  type: "function",
  function: {
    name: "http_request",
    description: RESP_TOOL.description,
    parameters: RESP_TOOL.parameters,
  },
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface HttpArgs {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface StepRecord {
  ts: number;
  type: "request" | "response" | "reasoning" | "final" | "error";
  data: unknown;
}

// ── Logging ────────────────────────────────────────────────────────────────────

const recorded: StepRecord[] = [];

function logStep(type: StepRecord["type"], data: unknown): void {
  const step: StepRecord = { ts: Date.now(), type, data };
  process.stdout.write(JSON.stringify({ run_id: RUN_ID, ...step }) + "\n");
  if (RECORD) recorded.push(step);
  void postEvent(step);
}

async function postEvent(step: StepRecord): Promise<void> {
  try {
    await fetch(`${ORCH_URL}/api/runs/${RUN_ID}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run_id: RUN_ID, ...step }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // orchestrator offline — log to stdout only
  }
}

// ── Tool executor ──────────────────────────────────────────────────────────────

// Computed once from the env so the runtime check is against a fixed value.
const SHIELD_HOST = (() => {
  try { return new URL(SHIELD_URL).host; }
  catch { process.stderr.write(`Invalid SHIELD_URL: ${SHIELD_URL}\n`); process.exit(1); }
})() as string;

let requestCount = 0;
let lastRequestMs = 0;

async function executeHttpRequest(rawArgs: string | HttpArgs): Promise<unknown> {
  const args: HttpArgs =
    typeof rawArgs === "string" ? (JSON.parse(rawArgs) as HttpArgs) : rawArgs;

  // ── CODE-LEVEL host guard ─────────────────────────────────────────────────
  // Rejects any attempt to reach a host other than the configured shield.
  // This is enforced here in code — not just stated in the prompt.
  if (/^https?:\/\//i.test(args.path)) {
    const reqHost = new URL(args.path).host;
    if (reqHost !== SHIELD_HOST) {
      throw new Error(`REFUSED: host "${reqHost}" ≠ shield "${SHIELD_HOST}"`);
    }
  }

  if (requestCount >= MAX_REQUESTS) {
    throw new Error(`REFUSED: request budget exhausted (max ${MAX_REQUESTS}/run)`);
  }

  // Rate gate
  const now = Date.now();
  const wait = RATE_MS - (now - lastRequestMs);
  if (wait > 0) await sleep(wait);

  requestCount++;
  lastRequestMs = Date.now();

  const url = new URL(args.path, SHIELD_URL);

  // Second guard: verify the constructed URL's host after resolution
  if (url.host !== SHIELD_HOST) {
    throw new Error(`REFUSED: resolved URL host "${url.host}" ≠ shield "${SHIELD_HOST}"`);
  }

  const headers: Record<string, string> = {
    "user-agent":  "security-twin-agent/1.0",
    "x-demo-user": "alice",
    "x-run-id":    RUN_ID,
    ...(args.headers ?? {}),
  };

  logStep("request", {
    n: requestCount,
    method: args.method.toUpperCase(),
    url: url.toString(),
    user: headers["x-demo-user"],
  });

  const resp = await fetch(url.toString(), {
    method:  args.method.toUpperCase(),
    headers,
    body:    args.body ?? undefined,
    signal:  AbortSignal.timeout(10_000),
  });

  const body = await resp.text();
  const respHeaders: Record<string, string> = {};
  resp.headers.forEach((v, k) => { respHeaders[k] = v; });

  logStep("response", {
    status:  resp.status,
    headers: respHeaders,
    body:    body.slice(0, 2_000),
  });

  return { status: resp.status, headers: respHeaders, body };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Agent loop — OpenAI Responses API ─────────────────────────────────────────
// Uses previous_response_id for stateful continuation (no growing history array).

async function runWithResponsesApi(): Promise<void> {
  const c = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responsesApi = (c as any).responses as { create(p: Record<string, unknown>): Promise<any> } | undefined;
  if (!responsesApi?.create) {
    process.stderr.write("[agent] Responses API not in SDK — falling back to Chat Completions\n");
    return runWithChatCompletions();
  }
  const api = responsesApi;

  let prevId: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let input: any = `Begin security assessment of ${SHIELD_URL}. Run ID: ${RUN_ID}.`;

  for (let turn = 0; turn < 50 && requestCount < MAX_REQUESTS; turn++) {
    const params: Record<string, unknown> = { model: MODEL, input };
    if (prevId) {
      params.previous_response_id = prevId;
      // instructions + tools are inherited from the previous response
    } else {
      params.instructions = SYSTEM_PROMPT;
      params.tools        = [RESP_TOOL];
    }

    const response = await api.create(params);
    prevId = response.id as string;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = response.output as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolCalls = output.filter((i: any) => i.type === "function_call");

    if (!toolCalls.length) {
      // Agent finished — collect its text
      const summary: string =
        (response.output_text as string | undefined) ??
        output
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((i: any) => i.type === "message")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .flatMap((i: any) => i.content as any[])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => c.text ?? c.value ?? "")
          .join("\n");
      logStep("final", { summary, requests_made: requestCount });
      return;
    }

    // Execute each tool call and gather outputs for the next turn
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolOutputs: any[] = [];
    for (const tc of toolCalls) {
      logStep("reasoning", { name: tc.name, args: tc.arguments });
      let result: unknown;
      try {
        result = await executeHttpRequest(tc.arguments as string);
      } catch (err) {
        result = { error: (err as Error).message };
        logStep("error", { message: (err as Error).message });
      }
      toolOutputs.push({
        type: "function_call_output",
        call_id: tc.call_id as string,
        output: JSON.stringify(result),
      });
    }
    input = toolOutputs;
  }

  logStep("final", { summary: `Budget reached after ${requestCount} requests.`, requests_made: requestCount });
}

// ── Agent loop — Chat Completions (AkashML / Nebius / any compat provider) ────

async function runWithChatCompletions(): Promise<void> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: `Begin security assessment of ${SHIELD_URL}. Run ID: ${RUN_ID}.` },
  ];

  const c = getClient();

  for (let turn = 0; turn < 50 && requestCount < MAX_REQUESTS; turn++) {
    const completion = await c.chat.completions.create({
      model: MODEL,
      messages,
      tools: [CC_TOOL],
    });

    const choice = completion.choices[0];
    const msg    = choice.message;
    messages.push(msg as ChatCompletionMessageParam);

    if (!msg.tool_calls?.length || choice.finish_reason === "stop") {
      logStep("final", { summary: msg.content ?? "", requests_made: requestCount });
      return;
    }

    for (const tc of msg.tool_calls) {
      // openai v7 union type: only "function" tool calls carry .function
      if (tc.type !== "function") continue;
      logStep("reasoning", { name: tc.function.name, args: tc.function.arguments });
      let result: unknown;
      try {
        result = await executeHttpRequest(tc.function.arguments);
      } catch (err) {
        result = { error: (err as Error).message };
        logStep("error", { message: (err as Error).message });
      }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }

  logStep("final", { summary: `Budget reached after ${requestCount} requests.`, requests_made: requestCount });
}

// ── Dry-run replay ─────────────────────────────────────────────────────────────

async function runDry(): Promise<void> {
  if (!fs.existsSync(SAMPLE_FILE)) {
    process.stderr.write(
      `[agent] recordings/sample-run.json not found — run once with --record first.\n`
    );
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(SAMPLE_FILE, "utf8")) as {
    run_id: string;
    steps: StepRecord[];
  };
  process.stderr.write(`[agent] dry-run: replaying ${data.steps.length} steps (original run_id=${data.run_id})\n`);
  for (const step of data.steps) {
    process.stdout.write(JSON.stringify({ run_id: RUN_ID, ...step }) + "\n");
    await sleep(40);
  }
}

// ── Save recording ─────────────────────────────────────────────────────────────

function saveRecording(): void {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  const payload = {
    recorded_at: new Date().toISOString(),
    run_id: RUN_ID,
    model: MODEL,
    shield_url: SHIELD_URL,
    steps: recorded,
  };
  fs.writeFileSync(SAMPLE_FILE, JSON.stringify(payload, null, 2), "utf8");
  process.stderr.write(`[agent] recorded ${recorded.length} steps → ${SAMPLE_FILE}\n`);
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (DRY) { await runDry(); return; }

  process.stderr.write(
    `[agent] run=${RUN_ID} model=${MODEL} api=${USE_RESPONSES ? "responses" : "chat-completions"}\n`
  );
  process.stderr.write(`[agent] target=${SHIELD_URL}  budget=${MAX_REQUESTS}req @ 1/${RATE_MS}ms\n`);

  if (USE_RESPONSES) {
    await runWithResponsesApi();
  } else {
    await runWithChatCompletions();
  }

  if (RECORD) saveRecording();
  process.stderr.write(`[agent] done — ${requestCount} requests made\n`);
}

main().catch(err => {
  process.stderr.write(`[agent] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
