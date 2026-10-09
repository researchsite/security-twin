import { NextResponse } from "next/server";

const DEMO_MODE = process.env.DEMO_MODE !== "false";
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://localhost:4001";

const DEMO_MEMORY = [
  {
    _id: "SEC-001",
    bug_class: "IDOR",
    story: "Run demo-2024-idor: agent enumerated /api/kits/:id across users alice, bob, carol. IP 185.220.101.1 accessed 6 distinct kit IDs starting 2024-01-01 12:00:01. Semgrep confirmed getKit() called without owner check at src/index.ts:118. Fix applied (stage 9): in-handler ownership check — kit.ownerId !== currentUser(req). Signature-change alternative (getKitForUser) was considered but not chosen: changes public contract with no benefit over the in-handler guard.",
    invariant: "every kit read must be authorized against the current user (in-handler ownerId check or getKitForUser)",
    rule_path: "rules/memory/idor.yaml",
    vulnerable_snippet: "const kit = getKit(req.params.id); // IDOR: no owner check",
    fix_snippet: "if (!kit || kit.ownerId !== currentUser(req)) return res.status(404).json({ error: \"not found\" });",
    embedding: [],
    updated_at: "2024-01-01T12:10:30.200Z",
  },
];

export async function GET(): Promise<NextResponse> {
  if (DEMO_MODE) {
    return NextResponse.json(DEMO_MEMORY);
  }
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/memory`);
    if (!res.ok) return NextResponse.json(DEMO_MEMORY, { status: 200 });
    const docs = (await res.json()) as unknown[];
    // Fall back to demo data until MongoDB is wired and real runs populate memory
    return NextResponse.json(docs.length > 0 ? docs : DEMO_MEMORY);
  } catch {
    return NextResponse.json(DEMO_MEMORY, { status: 200 });
  }
}
