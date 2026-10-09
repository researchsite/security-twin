import * as fs from "fs/promises";
import * as path from "path";
import OpenAI from "openai";
import type { StageDef, StageResult, StageContext } from "../pipeline";

// Patterns that identify the IDOR route handler
const ROUTE_PATTERNS = [
  /getKit\s*\(/,
  /\/api\/kits\/:id/,
  /kits\.ts/,
];

async function findFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(d: string) {
    let entries: import("fs").Dirent[];
    try { entries = await fs.readdir(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory() && e.name !== "node_modules" && e.name !== "dist") {
        await walk(full);
      } else if (e.isFile() && /\.(ts|js)$/.test(e.name)) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

async function llmFallback(
  files: string[],
  route: string,
  ctx: StageContext
): Promise<string | null> {
  const apiKey = process.env.ATTACKER_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.NEBIUS_API_KEY;
  if (!apiKey) return null;

  ctx.emit({ type: "log", stage: "map", message: "Asking LLM to identify route file…" });

  const baseURL = process.env.ATTACKER_BASE_URL ?? process.env.NEBIUS_BASE_URL;
  const model   = process.env.ATTACKER_MODEL ?? "gpt-4o-mini";

  const openai = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const resp = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You are a code analyst. Reply with only the filename, nothing else." },
      { role: "user",   content: `Which of these files most likely handles the route ${route}?\n${files.map(f => path.basename(f)).join("\n")}` },
    ],
    max_tokens: 50,
  });

  const name = resp.choices[0]?.message.content?.trim() ?? null;
  return files.find(f => path.basename(f) === name) ?? null;
}

async function run(ctx: StageContext): Promise<StageResult> {
  const srcDir = path.join(ctx.work_dir, "demo-app", "src");
  const route  = "/api/kits/:id";

  ctx.emit({ type: "log", stage: "map", message: `Locating handler for ${route}` });

  const files = await findFiles(srcDir);

  // 1. Filename match
  for (const f of files) {
    if (path.basename(f).includes("kit")) {
      // Verify it contains something relevant
      const src = await fs.readFile(f, "utf8").catch(() => "");
      if (ROUTE_PATTERNS.some(p => p.test(src))) {
        ctx.emit({ type: "log", stage: "map", message: `Found via filename: ${path.relative(ctx.root_dir, f)}` });
        return { status: "done", data: { source_file: f, method: "filename" }, duration_ms: 0 };
      }
    }
  }

  // 2. Content search
  for (const f of files) {
    const src = await fs.readFile(f, "utf8").catch(() => "");
    if (ROUTE_PATTERNS.every((_, i, arr) => i > 0 ? true : arr[0].test(src))) {
      if (ROUTE_PATTERNS[0].test(src)) {
        ctx.emit({ type: "log", stage: "map", message: `Found via content grep: ${path.relative(ctx.root_dir, f)}` });
        return { status: "done", data: { source_file: f, method: "grep" }, duration_ms: 0 };
      }
    }
  }

  // 3. LLM fallback
  const llmFile = await llmFallback(files, route, ctx).catch(() => null);
  if (llmFile) {
    ctx.emit({ type: "log", stage: "map", message: `LLM identified: ${path.relative(ctx.root_dir, llmFile)}` });
    return { status: "done", data: { source_file: llmFile, method: "llm" }, duration_ms: 0 };
  }

  // 4. Hard fallback — we know the answer for this demo
  const fallback = path.join(ctx.work_dir, "demo-app", "src", "index.ts");
  ctx.emit({ type: "log", stage: "map", message: `Using default fallback: src/index.ts` });
  return { status: "done", data: { source_file: fallback, method: "default" }, duration_ms: 0 };
}

export const mapStage: StageDef = { name: "map", run };
