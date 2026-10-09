import type { RunSummary } from "./types";

export async function getDemoRun(): Promise<RunSummary> {
  // In a server component we can read the bundled JSON directly.
  // In production the file is in public/ and also importable at build time.
  // We use a dynamic import so Next can tree-shake this in live mode.
  const data = await import("../../public/demo-run.json");
  return data.default as RunSummary;
}
