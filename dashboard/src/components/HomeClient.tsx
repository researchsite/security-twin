"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Props {
  demoMode: boolean;
  demoRunId: string;
}

export function HomeClient({ demoMode, demoRunId }: Props) {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState(
    demoMode ? "https://github.com/security-twin/demo-app" : ""
  );
  const [unlockKey, setUnlockKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch() {
    if (demoMode) {
      router.push(`/runs/${demoRunId}`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/run/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Unlock": unlockKey,
        },
        body: JSON.stringify({ repo_url: repoUrl }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const run = await res.json() as { run_id: string };
      router.push(`/runs/${run.run_id}`);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      {/* Logo */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Security Twin
        </h1>
        <p className="mt-2 text-sm text-gray-500 tracking-widest uppercase">
          find bugs before your attacker does
        </p>
      </div>

      {/* Tagline */}
      <p className="mb-10 max-w-md text-center text-gray-400 text-sm leading-relaxed">
        Drop in a repo URL. An AI agent attacks it through the shield proxy.
        ClickHouse detects enumeration. Semgrep confirms the root cause.
        Memory remembers the invariant.
      </p>

      {/* Input row */}
      <div className="w-full max-w-xl space-y-3">
        <input
          type="url"
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          placeholder="https://github.com/your/repo"
          disabled={demoMode}
          className="w-full rounded border border-gray-700 bg-gray-900 px-4 py-3 font-mono text-sm text-gray-100 placeholder-gray-700 focus:border-green-600 focus:outline-none disabled:opacity-50"
        />

        {!demoMode && (
          <input
            type="password"
            value={unlockKey}
            onChange={e => setUnlockKey(e.target.value)}
            placeholder="Unlock key  (DASHBOARD_UNLOCK)"
            className="w-full rounded border border-gray-700 bg-gray-900 px-4 py-3 font-mono text-sm text-gray-100 placeholder-gray-700 focus:border-green-600 focus:outline-none"
          />
        )}

        <button
          onClick={handleLaunch}
          disabled={loading || (!demoMode && !unlockKey)}
          className="w-full rounded bg-green-700 px-4 py-3 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-40 transition-colors"
        >
          {loading ? "Starting…" : demoMode ? "Watch the attack →" : "Build the twin →"}
        </button>

        {error && (
          <p className="text-center text-xs text-red-400">{error}</p>
        )}
      </div>

      {/* Demo mode badge */}
      {demoMode && (
        <p className="mt-6 text-xs text-yellow-600">
          DEMO MODE — serving bundled recording · live attacks disabled
        </p>
      )}

      {/* Recorded run link */}
      <div className="mt-8">
        <Link
          href={`/runs/${demoRunId}`}
          className="text-xs text-gray-600 underline underline-offset-2 hover:text-gray-400"
        >
          → view a recorded attack run
        </Link>
      </div>

      {/* Pipeline steps */}
      <div className="mt-16 grid grid-cols-4 gap-6 text-center max-w-2xl w-full">
        {STEPS.map(s => (
          <div key={s.label} className="space-y-1.5">
            <p className="text-lg">{s.icon}</p>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">{s.label}</p>
            <p className="text-xs text-gray-700 leading-relaxed">{s.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  { icon: "⬡", label: "Clone",   desc: "Spin up an isolated twin of the target app" },
  { icon: "⚡", label: "Attack",  desc: "AI agent probes for IDOR, SSRF, auth bypass" },
  { icon: "◈",  label: "Detect",  desc: "ClickHouse flags enumeration in < 30 ms" },
  { icon: "◉",  label: "Remember", desc: "Semgrep rule + embedding saved to memory" },
];
