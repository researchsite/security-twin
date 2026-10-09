import { createClient, type ClickHouseClient } from "@clickhouse/client";

// ── ClickHouse client (lazy singleton) ────────────────────────────────────────

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

// ── Schema DDL ────────────────────────────────────────────────────────────────

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS requests (
    ts          DateTime64(3, 'UTC'),
    run_id      String,
    session_id  String,
    ip          String,
    user_agent  String,
    method      LowCardinality(String),
    path        String,
    status      UInt16,
    flagged     UInt8,
    flag_reason String,
    is_decoy    UInt8
  ) ENGINE = MergeTree()
  ORDER BY (run_id, ts)`,

  `CREATE TABLE IF NOT EXISTS requests_per_second (
    run_id  String,
    second  DateTime,
    total   SimpleAggregateFunction(sum, UInt64),
    flagged SimpleAggregateFunction(sum, UInt64),
    decoy   SimpleAggregateFunction(sum, UInt64)
  ) ENGINE = AggregatingMergeTree()
  ORDER BY (run_id, second)`,

  `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_per_second_mv
  TO requests_per_second
  AS SELECT
    run_id,
    toStartOfSecond(ts)             AS second,
    toUInt64(count())               AS total,
    toUInt64(countIf(flagged = 1))  AS flagged,
    toUInt64(countIf(is_decoy = 1)) AS decoy
  FROM requests
  GROUP BY run_id, second`,

  `CREATE TABLE IF NOT EXISTS requests_kit_enum (
    run_id         String,
    ip             String,
    minute         DateTime,
    kit_hits       SimpleAggregateFunction(sum, UInt64),
    unique_kit_ids AggregateFunction(uniqExact, String)
  ) ENGINE = AggregatingMergeTree()
  ORDER BY (run_id, ip, minute)`,

  `CREATE MATERIALIZED VIEW IF NOT EXISTS requests_kit_enum_mv
  TO requests_kit_enum
  AS SELECT
    run_id,
    ip,
    toStartOfMinute(ts)                                AS minute,
    toUInt64(count())                                   AS kit_hits,
    uniqExactState(extract(path, '/api/kits/([0-9]+)')) AS unique_kit_ids
  FROM requests
  WHERE match(path, '/api/kits/[0-9]+')
  GROUP BY run_id, ip, minute`,
];

/** Create the requests table + MVs. Idempotent (IF NOT EXISTS). */
export async function initRequestsSchema(): Promise<void> {
  const ch = client();
  if (!ch) { console.log("[CH] CLICKHOUSE_URL not set — requests schema skipped"); return; }
  for (const query of DDL) {
    await ch.command({ query });
  }
  console.log("[CH] requests schema ready (requests + 2 MVs)");
}

// ── Shared response wrapper ───────────────────────────────────────────────────

interface CHResponse<T> {
  data: T[];
  statistics: { elapsed: number; rows_read: number; bytes_read: number };
}

async function chQuery<T>(
  ch: ClickHouseClient,
  query: string,
  query_params?: Record<string, unknown>
): Promise<CHResponse<T>> {
  const rs = await ch.query({ query, format: "JSON", query_params });
  return JSON.parse(await rs.text()) as CHResponse<T>;
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export interface TimelinePoint {
  second: string;
  total: number;
  flagged: number;
  decoy: number;
}

export interface TimelineMeta {
  elapsed_ms: number;
  rows_scanned: number;
  total_rows: number;
}

export async function getTimeline(
  run_id: string,
  limit = 300
): Promise<{ points: TimelinePoint[]; meta: TimelineMeta }> {
  const ch = client();
  if (!ch) return { points: [], meta: { elapsed_ms: 0, rows_scanned: 0, total_rows: 0 } };

  const t0 = Date.now();

  const [timeline, stats] = await Promise.all([
    chQuery<{ second: string; total: string; flagged: string; decoy: string }>(
      ch,
      `SELECT second,
              sum(total)   AS total,
              sum(flagged) AS flagged,
              sum(decoy)   AS decoy
         FROM requests_per_second
        WHERE run_id = {run_id: String}
        GROUP BY second
        ORDER BY second ASC
        LIMIT {limit: UInt32}`,
      { run_id, limit }
    ),
    chQuery<{ n: string }>(
      ch,
      `SELECT count() AS n FROM requests WHERE run_id = {run_id: String}`,
      { run_id }
    ),
  ]);

  return {
    points: timeline.data.map((r) => ({
      second: r.second,
      total: Number(r.total),
      flagged: Number(r.flagged),
      decoy: Number(r.decoy),
    })),
    meta: {
      elapsed_ms: Date.now() - t0,
      rows_scanned: timeline.statistics.rows_read + stats.statistics.rows_read,
      total_rows: Number(stats.data[0]?.n ?? 0),
    },
  };
}

// ── IDOR Detection ────────────────────────────────────────────────────────────

export interface DetectionFinding {
  ip: string;
  total_kit_hits: number;
  distinct_kit_ids: number;
  first_seen: string;
  last_seen: string;
  window_minutes: number;
}

export interface DetectionResult {
  findings: DetectionFinding[];
  meta: { elapsed_ms: number; rows_scanned: number };
}

/**
 * Detect IDOR enumeration by querying the pre-aggregated kit-hit MV.
 * Any IP that hit ≥3 distinct /api/kits/:id values within one run is flagged.
 */
export async function detectAttack(run_id: string): Promise<DetectionResult> {
  const ch = client();
  if (!ch) return { findings: [], meta: { elapsed_ms: 0, rows_scanned: 0 } };

  const t0 = Date.now();

  const resp = await chQuery<{
    ip: string;
    total_kit_hits: string;
    distinct_kit_ids: string;
    first_seen: string;
    last_seen: string;
    window_minutes: string;
  }>(
    ch,
    `SELECT
       ip,
       sum(kit_hits)                   AS total_kit_hits,
       uniqExactMerge(unique_kit_ids)  AS distinct_kit_ids,
       toString(min(minute))           AS first_seen,
       toString(max(minute))           AS last_seen,
       dateDiff('minute', min(minute), max(minute)) + 1 AS window_minutes
     FROM requests_kit_enum
    WHERE run_id = {run_id: String}
    GROUP BY ip
   HAVING distinct_kit_ids >= 3
    ORDER BY distinct_kit_ids DESC, total_kit_hits DESC
    LIMIT 20`,
    { run_id }
  );

  return {
    findings: resp.data.map((r) => ({
      ip: r.ip,
      total_kit_hits: Number(r.total_kit_hits),
      distinct_kit_ids: Number(r.distinct_kit_ids),
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      window_minutes: Number(r.window_minutes),
    })),
    meta: {
      elapsed_ms: Date.now() - t0,
      rows_scanned: resp.statistics.rows_read,
    },
  };
}
