import { NextRequest } from "next/server";
import * as fs from "fs";
import * as http from "http";
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

  // Live: proxy SSE from orchestrator using Node.js http.request
  // fetch/undici does not reliably flush streaming responses in Next.js dev mode
  const orchUrl = new URL(`${ORCHESTRATOR_URL}/api/runs/${id}/stream`);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const upstreamReq = http.request(
        {
          hostname: orchUrl.hostname,
          port:     parseInt(orchUrl.port || "80", 10),
          path:     orchUrl.pathname,
          method:   "GET",
          headers:  { Accept: "text/event-stream" },
        },
        (res) => {
          res.on("data",  (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          res.on("end",   () => controller.close());
          res.on("error", () => controller.close());
        }
      );
      upstreamReq.on("error", () => controller.close());
      upstreamReq.end();
      // Clean up when client disconnects
      req.signal.addEventListener("abort", () => upstreamReq.destroy());
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":       "text/event-stream",
      "Cache-Control":      "no-cache",
      "X-Accel-Buffering":  "no",
      "Connection":         "keep-alive",
    },
  });
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
