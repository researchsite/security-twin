"use client";

import { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimelinePoint {
  second: string;
  total: number;
  flagged: number;
  decoy: number;
}

interface TimelineData {
  points: TimelinePoint[];
  meta: { elapsed_ms: number; rows_scanned: number; total_rows: number };
  error?: string;
}

interface DetectionFinding {
  ip: string;
  total_kit_hits: number;
  distinct_kit_ids: number;
  first_seen: string;
  last_seen: string;
  window_minutes: number;
}

interface DetectionData {
  findings: DetectionFinding[];
  meta: { elapsed_ms: number; rows_scanned: number };
  error?: string;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ points }: { points: TimelinePoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-16 items-center justify-center text-xs text-gray-600">
        awaiting data…
      </div>
    );
  }

  const W = 600;
  const H = 56;
  const PAD = 2;

  const totals  = points.map((p) => p.total);
  const flagged = points.map((p) => p.flagged);
  const max     = Math.max(...totals, 1);

  function toPath(values: number[], clr: string) {
    const pts = values
      .map((v, i) => {
        const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
        const y = H - PAD - (v / max) * (H - PAD * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return (
      <polyline
        key={clr}
        points={pts}
        fill="none"
        stroke={clr}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    );
  }

  const peak = Math.max(...totals);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: "64px" }}
        preserveAspectRatio="none"
      >
        {toPath(totals, "#22c55e")}
        {toPath(flagged, "#f97316")}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded bg-green-500" />
          total
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded bg-orange-500" />
          flagged
        </span>
        <span className="ml-auto">peak {peak.toLocaleString()} req/s</span>
      </div>
    </div>
  );
}

// ── Detection table ───────────────────────────────────────────────────────────

function DetectionTable({ findings }: { findings: DetectionFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="text-xs text-gray-600">
        No IDOR enumeration detected yet (threshold: ≥3 distinct kit IDs).
      </p>
    );
  }

  return (
    <div className="overflow-auto rounded border border-red-900">
      <table className="w-full text-xs">
        <thead className="bg-red-950 text-red-300">
          <tr>
            <th className="px-3 py-2 text-left">IP</th>
            <th className="px-3 py-2 text-right">Kit IDs</th>
            <th className="px-3 py-2 text-right">Hits</th>
            <th className="px-3 py-2 text-right">Window</th>
            <th className="px-3 py-2 text-left">First seen</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.ip} className="border-t border-red-900 bg-gray-950">
              <td className="px-3 py-1.5 font-mono text-red-400">{f.ip}</td>
              <td className="px-3 py-1.5 text-right font-bold text-red-300">
                {f.distinct_kit_ids}
              </td>
              <td className="px-3 py-1.5 text-right text-gray-300">
                {f.total_kit_hits.toLocaleString()}
              </td>
              <td className="px-3 py-1.5 text-right text-gray-400">
                {f.window_minutes}m
              </td>
              <td className="px-3 py-1.5 font-mono text-gray-500">
                {f.first_seen.slice(11, 19)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface Props {
  runId: string;
}

export function CHAnalyticsPanel({ runId }: Props) {
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [detection, setDetection] = useState<DetectionData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      try {
        const [tRes, dRes] = await Promise.all([
          fetch(`/api/runs/${runId}/timeline`),
          fetch(`/api/runs/${runId}/detect`),
        ]);
        if (!cancelled) {
          setTimeline(await tRes.json() as TimelineData);
          setDetection(await dRes.json() as DetectionData);
        }
      } catch {
        // network error — keep previous data
      }
    }

    void fetchAll();
    const id = setInterval(fetchAll, 3_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [runId]);

  const totalRows  = timeline?.meta.total_rows ?? 0;
  const scanMs     = detection?.meta.elapsed_ms ?? 0;
  const scanRows   = detection?.meta.rows_scanned ?? 0;

  return (
    <div className="space-y-4 rounded border border-gray-800 bg-gray-950 p-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-300">ClickHouse Analytics</h2>

        <Badge color="blue">
          {totalRows.toLocaleString()} rows
        </Badge>

        {scanRows > 0 && (
          <Badge color="purple">
            scanned {scanRows.toLocaleString()} rows in {scanMs} ms
          </Badge>
        )}
      </div>

      {/* Timeline */}
      <section>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Requests / second
        </p>
        <Sparkline points={timeline?.points ?? []} />
      </section>

      {/* IDOR detection */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            IDOR detection
          </p>
          {detection && detection.findings.length > 0 && (
            <span className="rounded bg-red-700 px-2 py-0.5 text-xs font-bold text-white">
              {detection.findings.length} attacker{detection.findings.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <DetectionTable findings={detection?.findings ?? []} />
      </section>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "blue" | "purple";
}) {
  const cls =
    color === "blue"
      ? "bg-blue-900 text-blue-300"
      : "bg-purple-900 text-purple-300";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-mono ${cls}`}>
      {children}
    </span>
  );
}
