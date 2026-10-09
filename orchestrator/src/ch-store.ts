import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { AttackEvent } from "./types";

const TABLE = "attack_events";
let _client: ClickHouseClient | null = null;

function client(): ClickHouseClient | null {
  if (_client) return _client;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  _client = createClient({
    url,
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
  });
  return _client;
}

/** Create the attack_events table if it doesn't exist. Call once on startup. */
export async function initClickHouse(): Promise<void> {
  const ch = client();
  if (!ch) {
    console.log("[CH] CLICKHOUSE_URL not set — persistence disabled");
    return;
  }
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        run_id           String,
        event_id         String,
        ts               DateTime64(3, 'UTC'),
        category         LowCardinality(String),
        payload          String,
        target_path      String,
        method           LowCardinality(String),
        status_code      UInt16,
        outcome          LowCardinality(String),
        duration_ms      UInt32,
        response_snippet String DEFAULT ''
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (run_id, ts)
    `,
  });
  console.log("[CH] attack_events table ready");
}

/** Persist a single AttackEvent row. Fire-and-forget — never throws. */
export async function persistEvent(runId: string, event: AttackEvent): Promise<void> {
  const ch = client();
  if (!ch) return;
  try {
    await ch.insert({
      table: TABLE,
      values: [
        {
          run_id: runId,
          event_id: event.id,
          ts: new Date(event.ts).toISOString().replace("T", " ").slice(0, 23),
          category: event.category,
          payload: event.payload,
          target_path: event.targetPath,
          method: event.method,
          status_code: event.statusCode,
          outcome: event.outcome,
          duration_ms: event.durationMs,
          response_snippet: event.responseSnippet ?? "",
        },
      ],
      format: "JSONEachRow",
    });
  } catch (err) {
    console.error("[CH] insert failed:", (err as Error).message);
  }
}

/** Load all events for a run from ClickHouse (for dashboard historical view). */
export async function loadRunEvents(runId: string): Promise<AttackEvent[]> {
  const ch = client();
  if (!ch) return [];
  try {
    const rs = await ch.query({
      query: `
        SELECT *
        FROM   ${TABLE}
        WHERE  run_id = {runId: String}
        ORDER  BY ts ASC
      `,
      query_params: { runId },
      format: "JSONEachRow",
    });
    const rows = await rs.json<Record<string, unknown>>();
    return rows.map((r) => ({
      id:              String(r.event_id),
      ts:              new Date(String(r.ts) + "Z").getTime(),
      category:        r.category as AttackEvent["category"],
      payload:         String(r.payload),
      targetPath:      String(r.target_path),
      method:          String(r.method),
      statusCode:      Number(r.status_code),
      outcome:         r.outcome as AttackEvent["outcome"],
      durationMs:      Number(r.duration_ms),
      responseSnippet: r.response_snippet ? String(r.response_snippet) : undefined,
    }));
  } catch (err) {
    console.error("[CH] query failed:", (err as Error).message);
    return [];
  }
}

/** List distinct run IDs ordered by most recent first. */
export async function listRuns(): Promise<string[]> {
  const ch = client();
  if (!ch) return [];
  try {
    const rs = await ch.query({
      query: `
        SELECT   run_id, min(ts) AS started
        FROM     ${TABLE}
        GROUP BY run_id
        ORDER BY started DESC
        LIMIT    50
      `,
      format: "JSONEachRow",
    });
    const rows = await rs.json<{ run_id: string }>();
    return rows.map((r) => r.run_id);
  } catch {
    return [];
  }
}

export async function closeClickHouse(): Promise<void> {
  if (_client) { await _client.close(); _client = null; }
}
