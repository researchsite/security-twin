import Link from "next/link";

interface MemoryDoc {
  _id: string;
  bug_class: string;
  story: string;
  invariant: string;
  rule_path: string;
  vulnerable_snippet: string;
  fix_snippet: string;
  updated_at: string;
}

async function getMemory(): Promise<MemoryDoc[]> {
  try {
    // Route-relative URL works in both dev and production Next.js server components
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001";
    const res = await fetch(`${base}/api/memory`, { cache: "no-store" });
    if (!res.ok) return [];
    return res.json() as Promise<MemoryDoc[]>;
  } catch {
    return [];
  }
}

export default async function MemoryPage() {
  const docs = await getMemory();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Security Memory</h1>
          <p className="mt-0.5 text-xs text-gray-600">
            Invariants learned from past runs — used to generate Semgrep rules and guide future attacks.
          </p>
        </div>
        <span className="rounded bg-gray-900 px-2.5 py-1 text-xs text-gray-500">
          {docs.length} entr{docs.length === 1 ? "y" : "ies"}
        </span>
      </div>

      {docs.length === 0 ? (
        <div className="rounded border border-gray-900 bg-gray-950 px-6 py-10 text-center">
          <p className="text-sm text-gray-700">No memory entries yet.</p>
          <p className="mt-1 text-xs text-gray-800">
            Run a pipeline to populate security_memory.
          </p>
          <Link href="/" className="mt-4 inline-block text-xs text-gray-600 underline hover:text-gray-400">
            Start a run →
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {docs.map(doc => <MemoryCard key={doc._id} doc={doc} />)}
        </div>
      )}
    </div>
  );
}

function MemoryCard({ doc }: { doc: MemoryDoc }) {
  const updatedAt = (() => {
    try { return new Date(doc.updated_at).toLocaleDateString(); } catch { return doc.updated_at; }
  })();

  return (
    <article className="rounded border border-gray-800 bg-gray-950 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded bg-red-900/50 px-2 py-0.5 text-xs font-bold text-red-300">
            {doc.bug_class}
          </span>
          <span className="font-mono text-sm text-gray-300">{doc._id}</span>
        </div>
        <span className="flex-shrink-0 text-xs text-gray-700">{updatedAt}</span>
      </div>

      {/* Story */}
      <p className="text-xs text-gray-400 leading-relaxed">{doc.story}</p>

      {/* Invariant */}
      <div className="rounded border border-yellow-900/40 bg-yellow-950/10 px-3 py-2 text-xs">
        <span className="font-semibold text-yellow-600 uppercase tracking-wider">invariant  </span>
        <span className="text-yellow-300">{doc.invariant}</span>
      </div>

      {/* Code diff */}
      <div className="rounded bg-gray-900 px-4 py-3 font-mono text-xs leading-6 space-y-1">
        <div className="flex gap-2">
          <span className="select-none text-red-700">−</span>
          <span className="text-red-400">{doc.vulnerable_snippet}</span>
        </div>
        <div className="flex gap-2">
          <span className="select-none text-green-700">+</span>
          <span className="text-green-400">{doc.fix_snippet}</span>
        </div>
      </div>

      {/* Rule path */}
      <p className="text-xs text-gray-700">
        rule <span className="font-mono text-gray-500">{doc.rule_path}</span>
      </p>
    </article>
  );
}
