import * as fs from "fs/promises";
import * as path from "path";
import type { StageDef, StageResult, StageContext } from "../pipeline";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BriefData {
  text:        string;
  tts_ok:      boolean;
  audio_path?: string;  // absolute path on disk; served by /api/runs/:id/brief.mp3
  demo:        boolean;
}

// ── Demo fallback text (used when OPENAI_API_KEY is not set) ──────────────────

const DEMO_BRIEF_TEXT =
  "Security run demo-2024-idor complete. An AI red-team agent confirmed a " +
  "classic IDOR flaw: any authenticated user could access another user's kit " +
  "token simply by guessing the kit ID. The attacker's objective was to " +
  "enumerate all kit tokens across alice, bob, and carol — it succeeded, " +
  "hitting six distinct kit IDs within sixty seconds from a single IP. " +
  "The fix was non-breaking: a single in-handler ownership guard was added to " +
  "the GET slash api slash kits slash id endpoint — if the kit's owner does not " +
  "match the current user, return four-oh-four not found. No function signature " +
  "was changed, blast radius zero. Post-fix verification confirms all three " +
  "cross-user IDOR paths now return four-oh-four. Score dropped from one to zero. " +
  "Remediation complete.";

// ── HTTP helper ───────────────────────────────────────────────────────────────

function fetchTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(ctx: StageContext): string {
  const story      = (ctx.results["remember"]?.data as { story?: string } | undefined)?.story ?? "";
  const detectData = ctx.results["detect"]?.data as {
    findings?: Array<{ ip: string; distinct_kit_ids: number; total_kit_hits: number }>
  } | undefined;
  const fixData    = ctx.results["fix"]?.data as {
    fix_type?: string; score_before?: number; blast_radius?: { count: number }
  } | undefined;
  const proveData  = ctx.results["prove"]?.data as {
    score_after?: number; all_pass?: boolean
  } | undefined;

  const detectionLine = detectData?.findings?.length
    ? detectData.findings
        .map(f => `IP ${f.ip} hit ${f.distinct_kit_ids} distinct kit IDs (${f.total_kit_hits} requests)`)
        .join("; ")
    : "IDOR enumeration detected across multiple users";

  const fixLabel = fixData?.fix_type === "non_breaking"
    ? "non-breaking in-handler ownership check — zero signature change"
    : "signature change — call site replaced with getKitForUser";

  const scoreLine = fixData?.score_before !== undefined
    ? `Semgrep score: ${fixData.score_before} → ${proveData?.score_after ?? 0}`
    : "";

  const proofLine = proveData?.all_pass
    ? "All IDOR paths now return 404."
    : "Warning: some probes did not pass — manual review needed.";

  return [
    "You are writing a ~120-word spoken audio security briefing for a technical lead.",
    "No markdown, no bullets, no code blocks, no special characters.",
    "Write one plain paragraph suitable for text-to-speech.",
    "Mention: what endpoint was attacked, the attacker's objective, what data leaked,",
    "the fix type, and proof it works. End with a short conclusion.",
    "",
    `Run ID: ${ctx.run_id}`,
    `Endpoint: GET /api/kits/:id (IDOR — CWE-639 / OWASP A01)`,
    `Attacker objective: ${story ? story.slice(0, 250) : "enumerate kit tokens across all users"}`,
    `Detection: ${detectionLine}`,
    `Fix type: ${fixLabel}`,
    scoreLine,
    `Proof: ${proofLine}`,
    "",
    "Write exactly one paragraph of approximately 120 words.",
  ].filter(Boolean).join("\n");
}

// ── LLM call (OpenAI Chat Completions REST — no SDK dependency) ───────────────

async function callLLM(ctx: StageContext): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    ctx.emit({ type: "log", stage: "brief", message: "OPENAI_API_KEY not set — using demo brief text" });
    return DEMO_BRIEF_TEXT;
  }

  ctx.emit({ type: "log", stage: "brief", message: "Calling LLM for brief text (gpt-4o-mini)…" });

  const res = await fetchTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:       "gpt-4o-mini",
      messages:    [{ role: "user", content: buildPrompt(ctx) }],
      max_tokens:  250,
      temperature: 0.6,
    }),
  }, 30_000);

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 120)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
  };
  const text = (data.choices?.[0]?.message?.content ?? "").trim();
  return text || DEMO_BRIEF_TEXT;
}

// ── ElevenLabs TTS ─────────────────────────────────────────────────────────────
//
// SECURITY: never log full key or voice-id values — only confirm they were found.

async function synthesizeSpeech(text: string, ctx: StageContext): Promise<string | null> {
  const apiKey  = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) {
    ctx.emit({ type: "log", stage: "brief", message: "ELEVENLABS_API_KEY not set — audio skipped" });
    return null;
  }
  if (!voiceId) {
    ctx.emit({ type: "log", stage: "brief", message: "ELEVENLABS_VOICE_ID not set — audio skipped" });
    return null;
  }

  // Only say the keys were found, never their values
  ctx.emit({ type: "log", stage: "brief", message: "ELEVENLABS_API_KEY found · ELEVENLABS_VOICE_ID found — calling TTS…" });

  const res = await fetchTimeout(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
    30_000,
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${txt.slice(0, 120)}`);
  }

  const buf       = Buffer.from(await res.arrayBuffer());
  const audioPath = path.join(ctx.work_dir, "brief.mp3");

  await fs.mkdir(ctx.work_dir, { recursive: true }).catch(() => undefined);
  await fs.writeFile(audioPath, buf);

  ctx.emit({
    type: "log", stage: "brief",
    message: `Audio saved — ${(buf.length / 1024).toFixed(0)} KB → ${path.basename(audioPath)}`,
  });

  return audioPath;
}

// ── Stage ─────────────────────────────────────────────────────────────────────

async function run(ctx: StageContext): Promise<StageResult> {
  ctx.emit({ type: "log", stage: "brief", message: "Generating run summary…" });

  // 1. LLM text — fall back to demo text on any error
  let text = DEMO_BRIEF_TEXT;
  try {
    text = await callLLM(ctx);
    ctx.emit({
      type: "log", stage: "brief",
      message: `Brief ready — ${text.split(/\s+/).length} words`,
    });
  } catch (err) {
    ctx.emit({
      type: "log", stage: "brief",
      message: `LLM error: ${(err as Error).message} — using demo text`,
    });
  }

  ctx.emit({ type: "log", stage: "brief", message: "Synthesizing speech…" });

  // 2. TTS — non-fatal; run continues even if ElevenLabs is unavailable
  let audioPath: string | undefined;
  let ttsOk = false;
  try {
    const p = await synthesizeSpeech(text, ctx);
    if (p) { audioPath = p; ttsOk = true; }
  } catch (err) {
    ctx.emit({
      type: "log", stage: "brief",
      message: `⚠ ElevenLabs error: ${(err as Error).message} — continuing without audio`,
    });
  }

  const result: BriefData = { text, tts_ok: ttsOk, audio_path: audioPath, demo: !ttsOk };
  ctx.emit({ type: "data", stage: "brief", data: result });

  return { status: "done", demo: !ttsOk, data: result, duration_ms: 0 };
}

export const briefStage: StageDef = { name: "brief", run };
