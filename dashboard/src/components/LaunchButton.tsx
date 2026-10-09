"use client";

import { useState } from "react";
import type { RunSummary } from "@/lib/types";

interface LaunchButtonProps {
  onRunStart: (run: RunSummary) => void;
}

export function LaunchButton({ onRunStart }: LaunchButtonProps) {
  const [unlockKey, setUnlockKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/run/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Unlock": unlockKey,
        },
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      const run: RunSummary = await resp.json();
      onRunStart(run);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        type="password"
        placeholder="Unlock key"
        value={unlockKey}
        onChange={(e) => setUnlockKey(e.target.value)}
        className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-green-500"
      />
      <button
        onClick={launch}
        disabled={loading}
        className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-black hover:bg-green-500 disabled:opacity-50"
      >
        {loading ? "Launching…" : "Launch live attack"}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </div>
  );
}
