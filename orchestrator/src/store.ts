import { AttackEvent, RunSummary } from "./types";

let currentRun: RunSummary | null = null;

export function startRun(runId: string, twinUrl: string): RunSummary {
  currentRun = {
    runId,
    startedAt: Date.now(),
    twinUrl,
    totalAttacks: 0,
    blocked: 0,
    passed: 0,
    events: [],
  };
  return currentRun;
}

export function recordEvent(event: AttackEvent): void {
  if (!currentRun) throw new Error("No active run");
  currentRun.events.push(event);
  currentRun.totalAttacks += 1;
  if (event.outcome === "blocked") currentRun.blocked += 1;
  else if (event.outcome === "passed") currentRun.passed += 1;
}

export function finishRun(): RunSummary {
  if (!currentRun) throw new Error("No active run");
  currentRun.finishedAt = Date.now();
  return currentRun;
}

export function getRun(): RunSummary | null {
  return currentRun;
}
