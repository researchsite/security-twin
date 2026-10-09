import * as fs from "fs/promises";
import * as path from "path";
import type { StageDef, StageResult, StageContext } from "../pipeline";

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  async function walk(d: string) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      e.isDirectory()
        ? await walk(path.join(d, e.name))
        : n++;
    }
  }
  await walk(dir).catch(() => undefined);
  return n;
}

async function run(ctx: StageContext): Promise<StageResult> {
  const src = path.join(ctx.root_dir, "demo-app");
  const dst = path.join(ctx.work_dir, "demo-app");

  ctx.emit({ type: "log", stage: "clone", message: `Copying demo-app → ${dst}` });

  await fs.rm(ctx.work_dir, { recursive: true, force: true });
  await fs.mkdir(dst, { recursive: true });
  await fs.cp(src, dst, { recursive: true });

  const n = await countFiles(dst);
  ctx.emit({ type: "log", stage: "clone", message: `${n} files copied` });

  return { status: "done", data: { work_dir: ctx.work_dir, files: n }, duration_ms: 0 };
}

export const cloneStage: StageDef = { name: "clone", run, critical: true };
