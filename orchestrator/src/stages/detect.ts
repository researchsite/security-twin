import { detectAttack } from "../ch-requests";
import type { StageDef, StageResult, StageContext } from "../pipeline";

const DEMO_DETECTION = {
  findings: [
    {
      ip:               "185.220.101.1",
      total_kit_hits:   72,
      distinct_kit_ids: 6,
      first_seen:       "2024-01-01 12:00:00",
      last_seen:        "2024-01-01 12:00:58",
      window_minutes:   1,
    },
  ],
  meta: { elapsed_ms: 23, rows_scanned: 12_450 },
};

async function run(ctx: StageContext): Promise<StageResult> {
  ctx.emit({ type: "log", stage: "detect", message: `Running IDOR detection query for run ${ctx.run_id}` });

  try {
    const result = await detectAttack(ctx.run_id);

    if (result.findings.length === 0) {
      // No ClickHouse data yet (e.g., no traffic ran) — use demo
      ctx.emit({ type: "log", stage: "detect", message: "No live data — using demo detection result" });
      return { status: "done", demo: true, data: DEMO_DETECTION, duration_ms: 0 };
    }

    ctx.emit({
      type: "data",
      stage: "detect",
      data: {
        attackers:    result.findings.length,
        top_ip:       result.findings[0]?.ip,
        distinct_ids: result.findings[0]?.distinct_kit_ids,
        elapsed_ms:   result.meta.elapsed_ms,
        rows_scanned: result.meta.rows_scanned,
      },
    });

    return { status: "done", data: result, duration_ms: 0 };
  } catch (err) {
    ctx.emit({ type: "log", stage: "detect", message: `ClickHouse error — using demo: ${(err as Error).message}` });
    return { status: "done", demo: true, data: DEMO_DETECTION, duration_ms: 0 };
  }
}

export const detectStage: StageDef = { name: "detect", run };
