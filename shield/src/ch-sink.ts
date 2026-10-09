import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { LogSink, ShieldEvent } from "./types";

// ── Schema DDL (same as orchestrator/src/ch-requests.ts — both are idempotent) ─

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

async function createSchema(ch: ClickHouseClient): Promise<void> {
  for (const query of DDL) {
    await ch.command({ query });
  }
}

// ── Sink factory ──────────────────────────────────────────────────────────────

const FLUSH_MS   = 500;
const BATCH_SIZE = 10_000;
const MAX_BUFFER = 100_000;

/**
 * Creates a ClickHouse LogSink that batches inserts into the `requests` table.
 * Returns null if CLICKHOUSE_URL is not set.
 * Initialises the table schema before accepting events.
 */
export async function createClickHouseSink(): Promise<LogSink | null> {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;

  const ch = createClient({
    url,
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
  });

  await createSchema(ch);

  let buffer: ShieldEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;

  function scheduleFlush(): void {
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushNow();
      }, FLUSH_MS);
    }
  }

  async function flushNow(): Promise<void> {
    if (buffer.length === 0 || flushing) return;
    flushing = true;

    const batch = buffer.splice(0, BATCH_SIZE);

    try {
      await ch.insert({
        table: "requests",
        values: batch.map((ev) => ({
          ts:          new Date(ev.ts).toISOString().replace("T", " ").slice(0, 23),
          run_id:      ev.run_id,
          session_id:  ev.session_id,
          ip:          ev.ip,
          user_agent:  ev.user_agent,
          method:      ev.method,
          path:        ev.path,
          status:      ev.status,
          flagged:     ev.flagged ? 1 : 0,
          flag_reason: ev.flag_reason ?? "",
          is_decoy:    ev.is_decoy ? 1 : 0,
        })),
        format: "JSONEachRow",
      });
    } catch (err) {
      process.stderr.write(`[ch-sink] insert error: ${(err as Error).message}\n`);
    } finally {
      flushing = false;
      if (buffer.length >= BATCH_SIZE) void flushNow();
      else if (buffer.length > 0) scheduleFlush();
    }
  }

  const sink: LogSink = (event: ShieldEvent): void => {
    if (buffer.length >= MAX_BUFFER) {
      // Log the overflow threshold once, then drop silently
      if (buffer.length === MAX_BUFFER) {
        process.stderr.write("[ch-sink] buffer full (100k) — dropping events\n");
      }
      return;
    }
    buffer.push(event);
    if (buffer.length >= BATCH_SIZE) {
      void flushNow();
    } else {
      scheduleFlush();
    }
  };

  return sink;
}
