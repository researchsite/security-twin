"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  PipelineEvent, StageName, StageState, StageStatus,
  AgentEvent, Confession, DetectionFinding, SemgrepFinding,
  FixData, NeedsDecisionData, FixOption, FixChoice,
  ProbeEvent, ProveData, SyncData, AlertData, BriefData,
} from "@/lib/pipeline";
import { STAGE_NAMES, emptyStages } from "@/lib/pipeline";

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props { runId: string; demoMode: boolean }

// ── Stage-data helpers (typed subsets of stage_done.data) ────────────────────

interface ScanStageData {
  semgrep?: { results: SemgrepFinding[] };
  score_before?: number;
  finding_count?: number;
}
interface MapStageData   { source_file?: string; method?: string }
interface ConfirmStageData { findings?: SemgrepFinding[]; confirmed?: boolean }
interface DetectStageData  {
  findings?: DetectionFinding[];
  meta?: { elapsed_ms: number; rows_scanned: number };
}

// ── Main component ────────────────────────────────────────────────────────────

export function RunPage({ runId, demoMode }: Props) {
  const [stages, setStages]             = useState<Record<StageName, StageState>>(emptyStages);
  const [agentEvents, setAgentEvents]   = useState<AgentEvent[]>([]);
  const [confessions, setConfessions]   = useState<Confession[]>([]);
  const [fixData, setFixData]           = useState<FixData | null>(null);
  const [pendingDecision, setPendingDecision] = useState<NeedsDecisionData | null>(null);
  const [proveEvents, setProveEvents]   = useState<ProbeEvent[]>([]);
  const [proveData,   setProveData]     = useState<ProveData | null>(null);
  const [syncData,    setSyncData]      = useState<SyncData  | null>(null);
  const [alertData,   setAlertData]     = useState<AlertData | null>(null);
  const [briefData,   setBriefData]     = useState<BriefData | null>(null);
  const [runDone, setRunDone]           = useState(false);
  const [aborted, setAborted]           = useState(false);
  const feedRef   = useRef<HTMLDivElement>(null);
  const proveRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);

    es.onmessage = (raw: MessageEvent<string>) => {
      const ev = JSON.parse(raw.data) as PipelineEvent;

      switch (ev.type) {
        case "stage_start":
          if (!ev.stage) break;
          setStages(p => ({
            ...p,
            [ev.stage!]: { ...p[ev.stage! as StageName], status: "running" as StageStatus, startedAt: ev.ts },
          }));
          break;

        case "stage_done": {
          if (!ev.stage) break;
          const d = ev.data as { duration_ms?: number; demo?: boolean; data?: unknown } | undefined;
          setStages(p => ({
            ...p,
            [ev.stage!]: {
              ...p[ev.stage! as StageName],
              status: "done" as StageStatus,
              duration_ms: d?.duration_ms,
              demo: d?.demo,
              data: d?.data,
            },
          }));
          break;
        }

        case "stage_error":
          if (!ev.stage) break;
          setStages(p => ({
            ...p,
            [ev.stage!]: { ...p[ev.stage! as StageName], status: "failed" as StageStatus, error: ev.error },
          }));
          break;

        case "log":
          if (!ev.stage) break;
          setStages(p => ({
            ...p,
            [ev.stage!]: {
              ...p[ev.stage! as StageName],
              logs: [...(p[ev.stage! as StageName]?.logs ?? []), ev.message ?? ""],
            },
          }));
          break;

        case "data":
          if (ev.stage === "attack") {
            const ae = (ev.data as { agent_event?: AgentEvent })?.agent_event;
            if (ae) setAgentEvents(p => [...p, ae]);
          }
          if (ev.stage === "remember") {
            const cl = (ev.data as { confessions?: Confession[] })?.confessions;
            if (cl?.length) setConfessions(p => [...p, ...cl]);
          }
          if (ev.stage === "fix") {
            setFixData(ev.data as FixData);
          }
          if (ev.stage === "prove") {
            const pe = (ev.data as { probe_event?: ProbeEvent })?.probe_event;
            if (pe) {
              setProveEvents(p => [...p, pe]);
            } else {
              const d = ev.data as Partial<ProveData>;
              if (d.probes !== undefined) setProveData(d as ProveData);
            }
          }
          if (ev.stage === "sync") {
            const d = ev.data as Partial<SyncData>;
            if (d.files_committed !== undefined) setSyncData(d as SyncData);
          }
          if (ev.stage === "alert") {
            const d = ev.data as Partial<AlertData>;
            if (d.outcome !== undefined) setAlertData(d as AlertData);
          }
          if (ev.stage === "brief") {
            const d = ev.data as Partial<BriefData>;
            if (d.text !== undefined) setBriefData(d as BriefData);
          }
          break;

        case "needs_decision":
          if (ev.stage === "fix") {
            setPendingDecision(ev.data as NeedsDecisionData);
          }
          break;

        case "run_done":
          setRunDone(true);
          setAborted(!!(ev.data as { aborted?: boolean })?.aborted);
          break;
      }
    };

    es.onerror = () => es.close();
    return () => es.close();
  }, [runId]);

  // Auto-scroll attacker and prove feeds
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [agentEvents.length]);

  useEffect(() => {
    if (proveRef.current) proveRef.current.scrollTop = proveRef.current.scrollHeight;
  }, [proveEvents.length]);

  // Extract typed stage data
  const scanData    = stages.scan?.data    as ScanStageData    | undefined;
  const mapData     = stages.map?.data     as MapStageData     | undefined;
  const confirmData = stages.confirm?.data as ConfirmStageData | undefined;
  const detectData  = stages.detect?.data  as DetectStageData  | undefined;

  const runningStage = STAGE_NAMES.find(s => stages[s]?.status === "running");

  async function submitDecision(choice: FixChoice) {
    setPendingDecision(null);
    await fetch(`/api/runs/${encodeURIComponent(runId)}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice }),
    }).catch(() => undefined);
  }

  return (
    <div className="flex h-[calc(100vh-37px)] flex-col">
      {/* Sub-header */}
      <header className="flex items-center gap-3 border-b border-gray-900 px-5 py-2 text-xs">
        <span className="text-gray-600">run</span>
        <span className="font-mono text-gray-300">{runId}</span>
        {demoMode && (
          <span className="rounded bg-yellow-900/30 px-1.5 py-0.5 text-yellow-600">demo</span>
        )}
        <span className="ml-auto">
          {runDone
            ? aborted
              ? <span className="text-red-500">✗ aborted</span>
              : <span className="text-green-500">✓ complete</span>
            : runningStage
              ? <span className="animate-pulse text-yellow-400">◉ {runningStage}</span>
              : <span className="text-gray-700">○ pending</span>
          }
        </span>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Stage list ── */}
        <aside className="w-44 flex-shrink-0 overflow-y-auto border-r border-gray-900 p-4 pt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-700">stages</p>
          {STAGE_NAMES.map(n => <StageRow key={n} name={n} state={stages[n]} />)}
        </aside>

        {/* ── Panels ── */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Attacker feed */}
          <section>
            <Label>Attacker Feed</Label>
            <div
              ref={feedRef}
              className="h-44 overflow-y-auto rounded border border-gray-800 bg-black p-3 font-mono text-xs leading-5"
            >
              {agentEvents.length === 0
                ? <span className="text-gray-800">waiting for agent…</span>
                : agentEvents.map((ev, i) => <AgentLine key={i} ev={ev} />)
              }
            </div>
          </section>

          {/* Confession + ClickHouse */}
          <div className="grid grid-cols-2 gap-4">
            <section>
              <Label>Confession</Label>
              <ConfessionCard confessions={confessions} />
            </section>
            <section>
              <Label>ClickHouse Detection</Label>
              <CHCard detectData={detectData} />
            </section>
          </div>

          {/* Findings */}
          <section>
            <Label>Findings</Label>
            <FindingsCard
              scanData={scanData}
              mapData={mapData}
              confirmData={confirmData}
            />
          </section>

          {/* Decision gate — shown while fix stage is waiting for a choice */}
          {pendingDecision && (
            <section>
              <Label>Fix Decision Required</Label>
              <DecisionPanel decision={pendingDecision} onChoose={submitDecision} />
            </section>
          )}

          {/* Fix analysis — shown once the fix stage completes */}
          {fixData && (
            <section>
              <Label>Fix Analysis</Label>
              <FixPanel data={fixData} />
            </section>
          )}

          {/* Prove — post-fix IDOR probes */}
          {(proveEvents.length > 0 || proveData) && (
            <section>
              <Label>Proof — Post-Fix Verification</Label>
              <ProvePanel feedRef={proveRef} events={proveEvents} data={proveData} />
            </section>
          )}

          {/* Sync — GitHub PR */}
          {syncData && (
            <section>
              <Label>Sync — GitHub PR</Label>
              <SyncPanel data={syncData} />
            </section>
          )}

          {/* Alert — phone call outcome */}
          {alertData && (
            <section>
              <Label>Phone Alert</Label>
              <AlertPanel data={alertData} />
            </section>
          )}

          {/* Brief — audio summary */}
          {briefData && (
            <section>
              <Label>Audio Brief</Label>
              <BriefPanel runId={runId} data={briefData} />
            </section>
          )}

        </main>
      </div>
    </div>
  );
}

// ── Stage row ─────────────────────────────────────────────────────────────────

function StageRow({ name, state }: { name: string; state: StageState }) {
  const ICON: Record<StageStatus, string> = {
    pending: "○", running: "◉", done: "✓", failed: "✗",
  };
  const COLOR: Record<StageStatus, string> = {
    pending: "text-gray-800",
    running: "text-yellow-400 animate-pulse",
    done:    "text-green-500",
    failed:  "text-red-500",
  };
  const st  = state?.status ?? "pending";
  const dur = state?.duration_ms;

  return (
    <div className={`flex items-center justify-between py-1 text-xs ${st === "running" ? "opacity-100" : "opacity-60"}`}>
      <div className="flex items-center gap-1.5">
        <span className={COLOR[st]}>{ICON[st]}</span>
        <span className={st === "done" ? "text-gray-400" : st === "failed" ? "text-red-400" : "text-gray-700"}>
          {name}
        </span>
        {state?.demo && <span className="text-gray-800">~</span>}
      </div>
      {st === "done" && dur != null && (
        <span className="text-gray-800">
          {dur >= 1000 ? `${(dur / 1000).toFixed(1)}s` : `${dur}ms`}
        </span>
      )}
    </div>
  );
}

// ── Attacker feed line ────────────────────────────────────────────────────────

function AgentLine({ ev }: { ev: AgentEvent }) {
  const d = ev.data as unknown as Record<string, unknown>;
  switch (ev.type) {
    case "request": {
      const r = d as { n?: number; method?: string; url?: string; user?: string };
      return (
        <div className="flex items-baseline gap-2">
          <span className="text-gray-700">[{r.n}]</span>
          <span className="text-blue-400">{r.method}</span>
          <span className="text-cyan-300">{r.url}</span>
          {r.user && <span className="text-gray-600">as {r.user}</span>}
        </div>
      );
    }
    case "response": {
      const r = d as { status?: number; body?: string };
      const clr = (r.status ?? 200) < 300 ? "text-green-500"
                : (r.status ?? 200) < 500 ? "text-yellow-400" : "text-red-400";
      return (
        <div className="flex items-baseline gap-2">
          <span className="text-gray-800">└</span>
          <span className={clr}>{r.status}</span>
          <span className="text-gray-600">{String(r.body ?? "").slice(0, 90)}</span>
        </div>
      );
    }
    case "reasoning": {
      const r = d as { name?: string; args?: string };
      return (
        <div className="flex items-baseline gap-1.5 text-yellow-700">
          <span>⟳</span>
          <span>{r.name}</span>
          <span className="text-gray-700">{String(r.args ?? "").slice(0, 60)}</span>
        </div>
      );
    }
    case "final": {
      const r = d as { summary?: string };
      return (
        <div className="mt-1 border-t border-gray-900 pt-1 font-semibold text-green-400">
          ✓ {r.summary}
        </div>
      );
    }
    default:
      return <div className="text-gray-800">{JSON.stringify(ev).slice(0, 100)}</div>;
  }
}

// ── Confession card ───────────────────────────────────────────────────────────

function ConfessionCard({ confessions }: { confessions: Confession[] }) {
  const hasData = confessions.length > 0;
  return (
    <div className={`min-h-28 rounded border p-3 text-xs transition-all duration-500 ${
      hasData ? "border-orange-900/70 bg-orange-950/20" : "border-gray-900 bg-gray-950"
    }`}>
      {!hasData
        ? <p className="text-gray-800">agent has not confessed yet…</p>
        : confessions.map((c, i) => (
          <div key={i} className="space-y-2">
            <p className="font-semibold uppercase tracking-widest text-orange-500/80">objective</p>
            <p className="text-gray-300 leading-relaxed">{c.objective ?? "—"}</p>
            {Array.isArray(c.targets) && c.targets.length > 0 && (
              <>
                <p className="mt-2 font-semibold uppercase tracking-widest text-orange-500/80">targets</p>
                <div className="flex flex-wrap gap-1">
                  {(c.targets as string[]).map((t, ti) => (
                    <span key={ti} className="rounded bg-orange-900/30 px-1.5 py-0.5 font-mono text-orange-300">{t}</span>
                  ))}
                </div>
              </>
            )}
            <p className="text-gray-700 mt-1">session {c.session_id}</p>
          </div>
        ))
      }
    </div>
  );
}

// ── ClickHouse card ───────────────────────────────────────────────────────────

function CHCard({ detectData }: { detectData: DetectStageData | undefined }) {
  if (!detectData) {
    return (
      <div className="min-h-28 rounded border border-gray-900 bg-gray-950 p-3 text-xs">
        <p className="text-gray-800">waiting for detect stage…</p>
      </div>
    );
  }
  const { findings = [], meta } = detectData;
  return (
    <div className="min-h-28 rounded border border-gray-900 bg-gray-950 p-3 text-xs space-y-2">
      {meta && meta.rows_scanned > 0 && (
        <span className="inline-block rounded bg-purple-900/50 px-2 py-0.5 font-mono text-purple-300">
          scanned {meta.rows_scanned.toLocaleString()} rows in {meta.elapsed_ms} ms
        </span>
      )}
      {findings.length === 0
        ? <p className="text-gray-700">no IDOR enumeration detected</p>
        : findings.map((f, i) => (
          <div key={i} className="rounded border border-red-900/50 bg-red-950/20 px-3 py-2">
            <span className="font-mono text-red-400">{f.ip}</span>
            <span className="mx-2 text-gray-700">·</span>
            <span className="font-bold text-red-300">{f.distinct_kit_ids}</span>
            <span className="text-gray-600"> distinct kit IDs</span>
            <span className="mx-2 text-gray-700">·</span>
            <span className="text-gray-500">{f.total_kit_hits} hits / {f.window_minutes}m</span>
          </div>
        ))
      }
      {findings.length > 0 && (
        <p className="font-semibold text-red-500">⚠ IDOR enumeration detected</p>
      )}
    </div>
  );
}

// ── Findings card ─────────────────────────────────────────────────────────────

interface FindingsProps {
  scanData:    ScanStageData    | undefined;
  mapData:     MapStageData     | undefined;
  confirmData: ConfirmStageData | undefined;
}

function FindingsCard({ scanData, mapData, confirmData }: FindingsProps) {
  if (!scanData && !confirmData) {
    return (
      <div className="rounded border border-gray-900 bg-gray-950 p-4 text-xs text-gray-800">
        waiting for findings…
      </div>
    );
  }

  const finding  = confirmData?.findings?.[0] ?? scanData?.semgrep?.results?.[0];
  const fileName = mapData?.source_file?.split("/").pop() ?? mapData?.source_file ?? "—";
  const line     = finding?.start?.line ?? "??";
  const snippet  = finding?.extra?.lines?.trim() ?? "";

  return (
    <div className="grid grid-cols-3 gap-6 rounded border border-gray-900 bg-gray-950 p-4 text-xs">
      {/* Score */}
      <div className="space-y-2">
        <p className="font-semibold uppercase tracking-widest text-gray-700">Score</p>
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold text-red-400">{scanData?.score_before ?? 0}</span>
          <span className="text-gray-700">→</span>
          <span className="text-3xl font-bold text-green-500">0</span>
        </div>
        <p className="text-gray-700">findings before → after fix</p>
      </div>

      {/* Location */}
      <div className="space-y-2">
        <p className="font-semibold uppercase tracking-widest text-gray-700">Location</p>
        {mapData?.source_file
          ? <>
              <p className="font-mono text-blue-300">{fileName}</p>
              <p className="text-gray-600">line {line}</p>
              {mapData.method && <p className="text-gray-700">found via {mapData.method}</p>}
            </>
          : <p className="text-gray-800">—</p>
        }
      </div>

      {/* Rule + fix */}
      <div className="space-y-2">
        <p className="font-semibold uppercase tracking-widest text-gray-700">Rule</p>
        {confirmData?.confirmed
          ? <div className="space-y-1">
              <p className="text-yellow-400">CWE-639 · IDOR</p>
              <p className="text-gray-600">idor-kit-no-owner-check</p>
              <div className="mt-2 rounded bg-gray-900 p-2 leading-5">
                {snippet && <p className="text-red-400 line-through">{snippet}</p>}
                <p className="text-green-400">if (!kit || kit.ownerId !== currentUser(req))</p>
              </div>
            </div>
          : <p className="text-gray-800">—</p>
        }
      </div>
    </div>
  );
}

// ── Decision panel (safety gate UI) ──────────────────────────────────────────

function DecisionPanel({
  decision,
  onChoose,
}: {
  decision: NeedsDecisionData;
  onChoose: (choice: FixChoice) => void;
}) {
  return (
    <div className="rounded border border-yellow-700/50 bg-yellow-950/10 p-4 text-xs space-y-4">
      <div className="flex items-start gap-2">
        <span className="text-yellow-500 text-base">⚠</span>
        <div>
          <p className="font-semibold text-yellow-400">Safety gate triggered — human decision required</p>
          <p className="mt-1 text-yellow-700">{decision.reason}</p>
        </div>
      </div>

      {/* Blast radius */}
      <div>
        <p className="font-semibold uppercase tracking-widest text-gray-600 mb-1">
          Blast radius — {decision.blast_radius.count} caller{decision.blast_radius.count !== 1 ? "s" : ""} of {decision.blast_radius.function_name}(
        </p>
        <div className="space-y-0.5 font-mono">
          {decision.blast_radius.callers.map((c, i) => (
            <p key={i} className="text-gray-500">
              <span className="text-gray-400">{c.file.split("/").slice(-2).join("/")}</span>
              <span className="text-gray-700">:{c.line}</span>
              <span className="text-gray-700"> — </span>
              <span className="text-gray-600">{c.text.slice(0, 70)}</span>
            </p>
          ))}
        </div>
      </div>

      {/* Options */}
      <div className="grid grid-cols-2 gap-3">
        {decision.options.map(opt => (
          <OptionCard
            key={opt.choice}
            opt={opt}
            recommended={opt.choice === decision.recommendation}
            onChoose={() => onChoose(opt.choice)}
          />
        ))}
      </div>
    </div>
  );
}

function OptionCard({
  opt,
  recommended,
  onChoose,
}: {
  opt: FixOption;
  recommended: boolean;
  onChoose: () => void;
}) {
  return (
    <div className={`rounded border p-3 space-y-2 ${
      recommended
        ? "border-green-800/60 bg-green-950/10"
        : "border-gray-800 bg-gray-950"
    }`}>
      <div className="flex items-center gap-2">
        {opt.signature_change
          ? <span className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-yellow-500">sig change</span>
          : <span className="rounded bg-green-900/40 px-1.5 py-0.5 text-green-500">non-breaking</span>
        }
        {recommended && (
          <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-blue-400">recommended</span>
        )}
      </div>
      <p className="font-semibold text-gray-300">{opt.label}</p>
      <p className="text-gray-600 leading-relaxed">{opt.description}</p>
      <PatchPreview patch={opt.patch_preview} />
      <button
        onClick={onChoose}
        className={`w-full rounded py-1.5 text-xs font-semibold transition-colors ${
          recommended
            ? "bg-green-700 text-white hover:bg-green-600"
            : "bg-gray-800 text-gray-300 hover:bg-gray-700"
        }`}
      >
        Apply this fix →
      </button>
    </div>
  );
}

// ── Fix panel (post-fix summary) ──────────────────────────────────────────────

function FixPanel({ data }: { data: FixData }) {
  const isNonBreaking = data.fix_type === "non_breaking";
  const rejected = data.options.find(o => o.choice !== data.fix_type);

  return (
    <div className="rounded border border-gray-800 bg-gray-950 p-4 text-xs space-y-4">
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        {isNonBreaking
          ? <span className="rounded bg-green-900/40 px-2 py-0.5 font-semibold text-green-400">
              Fix type: non-breaking (in-handler check)
            </span>
          : <span className="rounded bg-yellow-900/40 px-2 py-0.5 font-semibold text-yellow-400">
              Fix type: signature change ({data.blast_radius.count} caller{data.blast_radius.count !== 1 ? "s" : ""} updated)
            </span>
        }
        <span className={`rounded px-2 py-0.5 font-mono ${
          data.score_after === 0
            ? "bg-green-900/30 text-green-400"
            : "bg-red-900/30 text-red-400"
        }`}>
          score {data.score_before} → {data.score_after} {data.score_after === 0 ? "✓" : "⚠"}
        </span>
        {data.auto_applied && (
          <span className="text-gray-700">auto-applied</span>
        )}
        {data.needs_decision && (
          <span className="rounded bg-yellow-900/30 px-1.5 py-0.5 text-yellow-600">decision was required</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Blast radius */}
        <div className="space-y-2">
          <p className="font-semibold uppercase tracking-widest text-gray-600">
            Blast Radius — {data.blast_radius.function_name}(
          </p>
          <p className="text-gray-500">
            {data.blast_radius.count} call site{data.blast_radius.count !== 1 ? "s" : ""} scanned
          </p>
          <div className="space-y-1 font-mono">
            {data.blast_radius.callers.map((c, i) => (
              <p key={i} className="text-gray-600">
                <span className="text-gray-400">{c.file.split("/").slice(-2).join("/")}</span>
                <span className="text-gray-700">:{c.line}</span>
              </p>
            ))}
          </div>
        </div>

        {/* Applied patch */}
        <div className="space-y-2">
          <p className="font-semibold uppercase tracking-widest text-gray-600">
            Patch Applied — {data.source_file.split("/").pop()}
          </p>
          <PatchPreview patch={data.patch} />
        </div>
      </div>

      {/* Rejected alternative */}
      {rejected && (
        <div className="rounded border border-gray-800 bg-black/30 p-3 space-y-1">
          <p className="font-semibold uppercase tracking-widest text-gray-700">Considered but not chosen</p>
          <div className="flex items-center gap-2">
            {rejected.signature_change
              ? <span className="rounded bg-yellow-900/30 px-1.5 py-0.5 text-yellow-600">sig change</span>
              : <span className="rounded bg-green-900/30 px-1.5 py-0.5 text-green-700">non-breaking</span>
            }
            <span className="text-gray-500">{rejected.label}</span>
          </div>
          <p className="text-gray-700 leading-relaxed">{rejected.description}</p>
          <PatchPreview patch={rejected.patch_preview} dimmed />
        </div>
      )}
    </div>
  );
}

// ── Patch preview ─────────────────────────────────────────────────────────────

function PatchPreview({ patch, dimmed }: { patch: string; dimmed?: boolean }) {
  return (
    <div className={`rounded bg-gray-900 px-3 py-2 font-mono text-xs leading-5 ${dimmed ? "opacity-50" : ""}`}>
      {patch.split("\n").map((line, i) => {
        const isAdd = line.startsWith("+");
        const isDel = line.startsWith("-");
        return (
          <p key={i} className={
            isAdd ? "text-green-400" :
            isDel ? "text-red-400" :
            "text-gray-600"
          }>
            {line}
          </p>
        );
      })}
    </div>
  );
}

// ── Prove panel ───────────────────────────────────────────────────────────────

function ProvePanel({
  feedRef,
  events,
  data,
}: {
  feedRef: React.RefObject<HTMLDivElement>;
  events: ProbeEvent[];
  data: ProveData | null;
}) {
  return (
    <div className="rounded border border-gray-800 bg-gray-950 p-4 text-xs space-y-3">
      {/* Probe feed */}
      <div
        ref={feedRef}
        className="h-36 overflow-y-auto rounded border border-gray-900 bg-black p-3 font-mono text-xs leading-5"
      >
        {events.length === 0
          ? <span className="text-gray-800">running probes…</span>
          : events.map((ev, i) => <ProbeLine key={i} ev={ev} />)
        }
      </div>

      {/* Summary row */}
      {data && (
        <div className="flex items-center gap-4 flex-wrap">
          <span className={`rounded px-2 py-0.5 font-mono font-semibold ${
            data.all_pass
              ? "bg-green-900/30 text-green-400"
              : "bg-red-900/30 text-red-400"
          }`}>
            score_after = {data.score_after} {data.all_pass ? "✓" : "⚠"}
          </span>
          <span className="text-gray-600">
            {data.probes.length} probes · {data.probes.filter(p => p.pass).length} pass
          </span>
          {data.demo && <span className="rounded bg-yellow-900/20 px-1.5 py-0.5 text-yellow-800">~ demo proof</span>}
        </div>
      )}

      {/* Per-probe table */}
      {data && data.probes.length > 0 && (
        <div className="space-y-0.5 font-mono">
          {data.probes.map((p, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span className={p.pass ? "text-green-600" : "text-red-500"}>{p.pass ? "✓" : "✗"}</span>
              <span className="text-blue-400">{p.method}</span>
              <span className="text-cyan-300">{p.url}</span>
              <span className="text-gray-600">as {p.user}</span>
              <span className="text-gray-700">→</span>
              <span className={p.status === p.expected ? "text-green-500" : "text-red-400"}>{p.status}</span>
              <span className="text-gray-800">(expected {p.expected})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProbeLine({ ev }: { ev: ProbeEvent }) {
  const d = ev.data as unknown as Record<string, unknown>;
  if (ev.type === "request") {
    const r = d as { n?: number; method?: string; url?: string; user?: string };
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-gray-700">[{r.n}]</span>
        <span className="text-blue-400">{r.method}</span>
        <span className="text-cyan-300">{r.url}</span>
        {r.user && <span className="text-gray-600">as {r.user}</span>}
      </div>
    );
  }
  if (ev.type === "response") {
    const r = d as { status?: number; body?: string; pass?: boolean };
    const clr = (r.status ?? 200) < 300 ? "text-green-500"
              : (r.status ?? 200) < 500 ? "text-yellow-400" : "text-red-400";
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-gray-800">└</span>
        <span className={clr}>{r.status}</span>
        <span className="text-gray-600">{String(r.body ?? "").slice(0, 80)}</span>
        {r.pass !== undefined && (
          <span className={r.pass ? "text-green-700" : "text-red-600"}>
            {r.pass ? "✓" : "✗"}
          </span>
        )}
      </div>
    );
  }
  return null;
}

// ── Sync panel ────────────────────────────────────────────────────────────────

function SyncPanel({ data }: { data: SyncData }) {
  return (
    <div className={`rounded border p-4 text-xs space-y-3 ${
      data.skipped
        ? "border-gray-800 bg-gray-950"
        : "border-blue-900/50 bg-blue-950/10"
    }`}>
      {/* Status row */}
      {data.skipped ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-gray-700">~</span>
            <span className="text-gray-500">Sync skipped — {data.reason}</span>
          </div>
          <p className="text-gray-700">
            Set{" "}
            <span className="font-mono text-gray-500">GITHUB_FORK=owner/repo</span>
            {" "}and{" "}
            <span className="font-mono text-gray-500">GITHUB_TOKEN</span>
            {" "}to create a real PR.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="rounded bg-blue-900/40 px-2 py-0.5 font-semibold text-blue-400">
            PR #{data.pr_number}
          </span>
          {data.pr_url && (
            <a
              href={data.pr_url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-500 underline hover:text-blue-400"
            >
              {data.repo} ↗
            </a>
          )}
          <span className="font-mono text-gray-600">{data.branch}</span>
        </div>
      )}

      {/* Files */}
      <div>
        <p className="mb-1 font-semibold uppercase tracking-widest text-gray-700">
          {data.skipped ? "Would commit" : "Committed"}
        </p>
        <div className="space-y-0.5 font-mono">
          {data.files_committed.map((f, i) => (
            <p key={i} className="text-gray-600">{f}</p>
          ))}
        </div>
      </div>

      {/* Fix summary */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`rounded px-1.5 py-0.5 ${
          data.fix_type === "non_breaking"
            ? "bg-green-900/30 text-green-500"
            : "bg-yellow-900/30 text-yellow-500"
        }`}>
          {data.fix_type === "non_breaking" ? "non-breaking" : "sig change"}
        </span>
        <span className="text-gray-600">
          blast radius: {data.blast_radius_count} caller{data.blast_radius_count !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

// ── Alert panel ───────────────────────────────────────────────────────────────

function AlertPanel({ data }: { data: AlertData }) {
  const OUTCOME_STYLE: Record<string, string> = {
    approved:    "bg-green-900/40 text-green-400",
    rejected:    "bg-red-900/40 text-red-400",
    no_answer:   "bg-yellow-900/40 text-yellow-500",
    no_decision: "bg-yellow-900/40 text-yellow-600",
    failed:      "bg-red-900/30 text-red-500",
    skipped:     "bg-gray-800 text-gray-500",
  };
  const OUTCOME_ICON: Record<string, string> = {
    approved: "✓", rejected: "✗", no_answer: "~", no_decision: "~", failed: "⚠", skipped: "~",
  };

  const styleKey = data.outcome in OUTCOME_STYLE ? data.outcome : "skipped";

  return (
    <div className={`rounded border p-4 text-xs space-y-3 ${
      data.skipped ? "border-gray-800 bg-gray-950" : "border-gray-700 bg-gray-950"
    }`}>
      {/* Status row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`rounded px-2 py-0.5 font-semibold ${OUTCOME_STYLE[styleKey]}`}>
          {OUTCOME_ICON[styleKey]} {data.outcome}
        </span>
        {data.to_masked && (
          <span className="font-mono text-gray-600">called {data.to_masked}</span>
        )}
        {data.skipped && (
          <span className="text-gray-600">
            Set{" "}
            <span className="font-mono text-gray-500">PHONE_ALERTS=true</span>
            {", "}
            <span className="font-mono text-gray-500">ON_CALL_NUMBER</span>
            {", "}
            <span className="font-mono text-gray-500">GUAVA_API_KEY</span>
            {", "}
            <span className="font-mono text-gray-500">GUAVA_AGENT_NUMBER</span>
            {" to enable."}
          </span>
        )}
      </div>

      {/* Decision */}
      {!data.skipped && data.approved !== null && (
        <div className="flex items-center gap-2">
          <span className="font-semibold uppercase tracking-widest text-gray-600">Decision</span>
          <span className={`rounded px-2 py-0.5 font-semibold ${
            data.approved ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"
          }`}>
            {data.approved ? "Approved" : "Rejected"}
          </span>
        </div>
      )}

      {/* Reason */}
      {data.reason && (
        <p className="text-gray-700">{data.reason}</p>
      )}
    </div>
  );
}

// ── Brief panel ───────────────────────────────────────────────────────────────

function BriefPanel({ runId, data }: { runId: string; data: BriefData }) {
  return (
    <div className="rounded border border-gray-800 bg-gray-950 p-4 text-xs space-y-4">
      {/* Audio player — shown only when TTS succeeded */}
      {data.tts_ok ? (
        <div className="space-y-2">
          <p className="font-semibold uppercase tracking-widest text-gray-600">Audio</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            controls
            src={`/api/runs/${encodeURIComponent(runId)}/brief`}
            className="w-full rounded"
            style={{ colorScheme: "dark" }}
          />
        </div>
      ) : (
        <p className="text-gray-700">
          Audio not generated — set{" "}
          <span className="font-mono text-gray-500">ELEVENLABS_API_KEY</span>
          {" + "}
          <span className="font-mono text-gray-500">ELEVENLABS_VOICE_ID</span>
          {" to enable."}
        </p>
      )}

      {/* Text transcript — always shown */}
      <div className="space-y-2">
        <p className="font-semibold uppercase tracking-widest text-gray-600">Transcript</p>
        <p className="text-gray-300 leading-relaxed max-w-3xl">{data.text}</p>
        {data.demo && (
          <p className="text-gray-700">~ demo text — set OPENAI_API_KEY for a live-generated brief</p>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-gray-700">
      {children}
    </p>
  );
}
