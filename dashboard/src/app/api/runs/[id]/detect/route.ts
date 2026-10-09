import { createClient } from "@clickhouse/client";
import { NextRequest, NextResponse } from "next/server";

interface CHResponse<T> {
  data: T[];
  statistics: { elapsed: number; rows_read: number; bytes_read: number };
}

function makeClient() {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  return createClient({
    url,
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const run_id = params.id;
  const ch = makeClient();

  if (!ch) {
    return NextResponse.json(
      { error: "CLICKHOUSE_URL not configured", findings: [], meta: {} },
      { status: 200 }
    );
  }

  const t0 = Date.now();

  try {
    const rs = await ch.query({
      query: `SELECT
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
      format: "JSON",
      query_params: { run_id },
    });

    const elapsed_ms = Date.now() - t0;

    const body = JSON.parse(await rs.text()) as CHResponse<{
      ip: string;
      total_kit_hits: string;
      distinct_kit_ids: string;
      first_seen: string;
      last_seen: string;
      window_minutes: string;
    }>;

    return NextResponse.json({
      run_id,
      findings: body.data.map((r) => ({
        ip:               r.ip,
        total_kit_hits:   Number(r.total_kit_hits),
        distinct_kit_ids: Number(r.distinct_kit_ids),
        first_seen:       r.first_seen,
        last_seen:        r.last_seen,
        window_minutes:   Number(r.window_minutes),
      })),
      meta: {
        elapsed_ms,
        rows_scanned: body.statistics.rows_read,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, findings: [], meta: {} },
      { status: 500 }
    );
  } finally {
    await ch.close();
  }
}
