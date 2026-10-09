import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

const DEMO_MODE = process.env.DEMO_MODE !== "false";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:4001";
export const DEMO_RUN_ID = "demo-2024-idor";

interface DemoRun { run_id: string; events: unknown[] }

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<Response> {
  const { id } = params;

  // Always serve demo stream for the bundled run ID, even in live mode
  if (DEMO_MODE || id === DEMO_RUN_ID) {
    return streamDemoRun();
  }

  // Live: proxy SSE from orchestrator
  try {
    const upstream = await fetch(`${ORCHESTRATOR_URL}/api/runs/${id}/stream`, {
      signal: req.signal,
    });
    if (!upstream.body) {
      return new Response("no body", { status: 502 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type":       "text/event-stream",
        "Cache-Control":      "no-cache",
        "X-Accel-Buffering":  "no",
        "Connection":         "keep-alive",
      },
    });
  } catch {
    return new Response("orchestrator unreachable", { status: 502 });
  }
}

function streamDemoRun(): Response {
  const filePath = path.join(process.cwd(), "public", "demo-run.json");
  let demo: DemoRun;
  try {
    demo = JSON.parse(fs.readFileSync(filePath, "utf-8")) as DemoRun;
  } catch {
    return new Response("demo-run.json not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (const event of demo.events) {
          if (ac.signal.aborted) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          await sleep(80);
        }
      } finally {
        controller.close();
      }
    },
    cancel() { ac.abort(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
