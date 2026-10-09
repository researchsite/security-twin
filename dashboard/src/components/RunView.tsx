"use client";

import { useEffect, useState } from "react";
import type { RunSummary, AttackEvent } from "@/lib/types";
import { EventRow } from "./EventRow";
import { LaunchButton } from "./LaunchButton";

interface RunViewProps {
  initialRun: RunSummary | null;
  demoMode: boolean;
}

export function RunView({ initialRun, demoMode }: RunViewProps) {
  const [run, setRun] = useState<RunSummary | null>(initialRun);

  const blockedPct = run && run.totalAttacks > 0
    ? Math.round((run.blocked / run.totalAttacks) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      {run && (
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Total" value={run.totalAttacks} color="text-white" />
          <Stat label="Blocked" value={run.blocked} color="text-green-400" />
          <Stat label="Passed" value={run.passed} color="text-red-400" />
        </div>
      )}

      {/* Block-rate bar */}
      {run && run.totalAttacks > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-gray-400">
            <span>Block rate</span>
            <span>{blockedPct}%</span>
          </div>
          <div className="h-2 w-full rounded bg-gray-800">
            <div
              className="h-2 rounded bg-green-500 transition-all"
              style={{ width: `${blockedPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Launch button — only rendered when not demo mode */}
      {!demoMode && <LaunchButton onRunStart={setRun} />}

      {/* Events table */}
      {run && run.events.length > 0 ? (
        <div className="overflow-auto rounded border border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Path</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Outcome</th>
                <th className="px-3 py-2 text-right">ms</th>
              </tr>
            </thead>
            <tbody>
              {run.events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500">
          {demoMode
            ? "No demo run loaded. Add demo-run.json to dashboard/public/."
            : "No run data yet. Launch a run to begin."}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-900 px-4 py-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-3xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
