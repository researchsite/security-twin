/**
 * memory.ts — thin MongoDB wrapper.
 * Interface kept minimal so a future backend (Pi, etc.) can slot in by
 * replacing this module without touching any pipeline stage.
 */
import * as dns from "dns";
import { MongoClient, type Db } from "mongodb";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SecurityMemoryDoc {
  _id: string;             // "SEC-001", "SEC-002", …
  bug_class: string;       // "IDOR", "SQLi", …
  story: string;           // one-paragraph narrative of how the bug was found
  invariant: string;       // the rule that should always hold
  rule_path: string;       // relative path to the Semgrep YAML
  vulnerable_snippet: string;
  fix_snippet: string;
  embedding: number[];     // text-embedding-3-small of vulnerable_snippet
  updated_at: Date;
}

export interface RunDoc {
  _id: string;             // run_id
  stages: Record<string, unknown>;
  started_at: Date;
  finished_at?: Date;
}

export interface ConfessionDoc {
  run_id: string;
  session_id: string;
  objective?: unknown;
  targets?: unknown;
  raw_body: unknown;
  ts: Date;
}

// ── Connection (lazy singleton) ───────────────────────────────────────────────

let _client: MongoClient | null = null;
let _db: Db | null = null;

export async function connect(): Promise<Db | null> {
  if (_db) return _db;
  const url = process.env.MONGODB_URL;
  if (!url) {
    console.log("[MEMORY] MONGODB_URL not set — memory ops will no-op");
    return null;
  }
  // Home routers often block DNS SRV lookups used by mongodb+srv:// URIs.
  // Forcing Google DNS before the first connection resolves this.
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
  _client = new MongoClient(url);
  await _client.connect();
  _db = _client.db(process.env.MONGODB_DB ?? "security_twin");
  console.log("[MEMORY] MongoDB connected");
  return _db;
}

async function db(): Promise<Db | null> {
  if (_db) return _db;
  return connect();
}

export async function close(): Promise<void> {
  if (_client) { await _client.close(); _client = null; _db = null; }
}

// ── Public interface ──────────────────────────────────────────────────────────

/** Upsert a security finding into the knowledge base. */
export async function remember(doc: SecurityMemoryDoc): Promise<void> {
  const d = await db();
  if (!d) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await d.collection("security_memory").replaceOne({ _id: doc._id as any }, doc as any, { upsert: true });
  console.log(`[MEMORY] upserted ${doc._id} (${doc.bug_class})`);
}

/** Look up security findings, optionally filtered by bug_class. */
export async function recall(filter: Partial<Pick<SecurityMemoryDoc, "bug_class">> = {}): Promise<SecurityMemoryDoc[]> {
  const d = await db();
  if (!d) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return d.collection("security_memory").find(filter as any).toArray() as unknown as SecurityMemoryDoc[];
}

/** Store a completed run summary. */
export async function saveRun(run: RunDoc): Promise<void> {
  const d = await db();
  if (!d) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await d.collection("runs").replaceOne({ _id: run._id as any }, run as any, { upsert: true });
}

/** Store a confession posted by an agent via /.well-known/agent-audit. */
export async function saveConfession(confession: ConfessionDoc): Promise<void> {
  const d = await db();
  if (!d) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await d.collection("confessions").insertOne(confession as any);
}

/** Return the most recent run doc (for legacy dashboard /run/current). */
export async function getLatestRun(): Promise<RunDoc | null> {
  const d = await db();
  if (!d) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return d.collection<any>("runs").findOne({}, { sort: { started_at: -1 } }) as unknown as RunDoc | null;
}
