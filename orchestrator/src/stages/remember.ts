import OpenAI from "openai";
import * as memory from "../memory";
import type { StageDef, StageResult, StageContext } from "../pipeline";

const VULNERABLE_SNIPPET = "const kit = getKit(req.params.id); // IDOR: no owner check";
// Preferred fix is the non-breaking in-handler check (see fix stage).
// The signature-change alternative (getKitForUser) is also valid but changes
// the public contract — the fix stage decides which to apply.
const FIX_SNIPPET =
  "if (!kit || kit.ownerId !== currentUser(req)) return res.status(404).json({ error: \"not found\" });";

async function embed(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return [];
  try {
    const openai = new OpenAI({ apiKey });
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    return res.data[0]?.embedding ?? [];
  } catch (err) {
    process.stderr.write(`[remember] embed failed: ${(err as Error).message}\n`);
    return [];
  }
}

async function run(ctx: StageContext): Promise<StageResult> {
  ctx.emit({ type: "log", stage: "remember", message: "Computing embedding…" });
  const embedding = await embed(VULNERABLE_SNIPPET);

  const detectData = ctx.results["detect"]?.data as {
    findings?: Array<{ ip: string; distinct_kit_ids: number; first_seen: string }>;
    meta?: { elapsed_ms: number; rows_scanned: number };
  } | undefined;

  const topFinding = detectData?.findings?.[0];

  const story =
    `Run ${ctx.run_id}: agent enumerated /api/kits/:id across users alice, bob, carol. ` +
    (topFinding
      ? `IP ${topFinding.ip} accessed ${topFinding.distinct_kit_ids} distinct kit IDs ` +
        `starting ${topFinding.first_seen}. `
      : "") +
    `Semgrep confirmed getKit() called without owner check at src/index.ts:118. ` +
    `Fix applied (stage 9): in-handler ownership check — kit.ownerId !== currentUser(req).`;

  // ── Upsert security memory ─────────────────────────────────────────────────
  ctx.emit({ type: "log", stage: "remember", message: "Upserting SEC-001 into security_memory…" });
  await memory.remember({
    _id:                "SEC-001",
    bug_class:          "IDOR",
    story,
    invariant:          "every kit read must be authorized against the current user (in-handler ownerId check or getKitForUser)",
    rule_path:          "rules/memory/idor.yaml",
    vulnerable_snippet: VULNERABLE_SNIPPET,
    fix_snippet:        FIX_SNIPPET,
    embedding,
    updated_at:         new Date(),
  });

  // ── Save run ───────────────────────────────────────────────────────────────
  ctx.emit({ type: "log", stage: "remember", message: "Saving run to MongoDB…" });
  await memory.saveRun({
    _id:        ctx.run_id,
    stages:     ctx.results,
    started_at: new Date(ctx.started_at),
    finished_at: new Date(),
  });

  // ── Fetch and save confessions from shield ─────────────────────────────────
  const shieldUrl = process.env.SHIELD_URL ?? "http://localhost:8080";
  try {
    const res = await fetch(`${shieldUrl}/confessions`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      const all = await res.json() as Array<{ run_id: string; session_id: string; raw_body: unknown; objective?: unknown; targets?: unknown; ts: number }>;
      const mine = all.filter(x => x.run_id === ctx.run_id);
      for (const c of mine) {
        await memory.saveConfession({
          run_id:     c.run_id,
          session_id: c.session_id,
          objective:  c.objective,
          targets:    c.targets,
          raw_body:   c.raw_body,
          ts:         new Date(c.ts),
        });
      }
      // Emit confessions into the SSE stream so the dashboard can display them
      if (mine.length > 0) {
        ctx.emit({
          type: "data",
          stage: "remember",
          data: {
            confessions: mine.map(c => ({
              session_id: c.session_id,
              objective:  c.objective,
              targets:    c.targets,
              ts:         c.ts,
            })),
          },
        });
      }
      ctx.emit({ type: "log", stage: "remember", message: `Saved ${mine.length} confession(s)` });
    }
  } catch {
    ctx.emit({ type: "log", stage: "remember", message: "No confessions endpoint (shield not running)" });
  }

  return {
    status: "done",
    data: {
      memory_id:     "SEC-001",
      run_saved:     true,
      embedding_dim: embedding.length,
    },
    duration_ms: 0,
  };
}

export const rememberStage: StageDef = { name: "remember", run };
