import { NextRequest, NextResponse } from "next/server";

const DEMO_MODE = process.env.DEMO_MODE !== "false";
const DASHBOARD_UNLOCK = process.env.DASHBOARD_UNLOCK ?? "";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:4001";

export async function POST(req: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "Live runs are disabled in DEMO_MODE" }, { status: 403 });
  }

  const providedKey = req.headers.get("X-Dashboard-Unlock") ?? "";
  if (!DASHBOARD_UNLOCK || providedKey !== DASHBOARD_UNLOCK) {
    return NextResponse.json({ error: "Invalid unlock key" }, { status: 401 });
  }

  try {
    const resp = await fetch(`${ORCHESTRATOR_URL}/run/start`, { method: "POST" });
    if (!resp.ok) {
      return NextResponse.json({ error: "Orchestrator error" }, { status: 502 });
    }
    const run = await resp.json();
    return NextResponse.json(run);
  } catch {
    return NextResponse.json({ error: "Could not reach orchestrator" }, { status: 502 });
  }
}
