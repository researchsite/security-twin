import { NextRequest, NextResponse } from "next/server";

const DEMO_MODE = process.env.DEMO_MODE !== "false";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:4001";

export async function GET(_req: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "Live events not available in DEMO_MODE" }, { status: 403 });
  }

  try {
    const resp = await fetch(`${ORCHESTRATOR_URL}/run/current`);
    if (!resp.ok) return NextResponse.json({ error: "Orchestrator error" }, { status: 502 });
    const run = await resp.json();
    return NextResponse.json(run);
  } catch {
    return NextResponse.json({ error: "Could not reach orchestrator" }, { status: 502 });
  }
}
