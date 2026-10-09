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
      { error: "CLICKHOUSE_URL not configured", points: [], meta: {} },
      { status: 200 }
    );
  }

  const t0 = Date.now();

  try {
    const [timelineRs, statsRs] = await Promise.all([
      ch.query({
        query: `SELECT second,
                       sum(total)   AS total,
                       sum(flagged) AS flagged,
                       sum(decoy)   AS decoy
                  FROM requests_per_second
                 WHERE run_id = {run_id: String}
                 GROUP BY second
                 ORDER BY second ASC
                 LIMIT 600`,
        format: "JSON",
        query_params: { run_id },
      }),
      ch.query({
        query: `SELECT count() AS n FROM requests WHERE run_id = {run_id: String}`,
        format: "JSON",
        query_params: { run_id },
      }),
    ]);

    const elapsed_ms = Date.now() - t0;

    const timeline = JSON.parse(await timelineRs.text()) as CHResponse<{
      second: string;
      total: string;
      flagged: string;
      decoy: string;
    }>;

    const stats = JSON.parse(await statsRs.text()) as CHResponse<{ n: string }>;

    return NextResponse.json({
      run_id,
      points: timeline.data.map((r) => ({
        second:  r.second,
        total:   Number(r.total),
        flagged: Number(r.flagged),
        decoy:   Number(r.decoy),
      })),
      meta: {
        elapsed_ms,
        rows_scanned: timeline.statistics.rows_read + stats.statistics.rows_read,
        total_rows:   Number(stats.data[0]?.n ?? 0),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, points: [], meta: {} },
      { status: 500 }
    );
  } finally {
    await ch.close();
  }
}
