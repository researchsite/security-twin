import { MongoClient } from "mongodb";
import { loadEnv, header, test, summary } from "./_env.mjs";

loadEnv();

const uri = process.env.MONGODB_URI;

header("MongoDB connectivity test");

if (!uri) {
  console.error("  ✗  MONGODB_URI not set in .env.local");
  process.exit(1);
}

// Mask password in display
const displayUri = uri.replace(/:([^@]+)@/, ":***@");
console.log(`  URI : ${displayUri}\n`);

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
let passed = 0, failed = 0;

function tally(r) { passed += r.passed; failed += r.failed; }

// 1. Connect
tally(await test("Connect", async () => { await client.connect(); }));

// 2. Ping
tally(await test("Ping (serverStatus)", async () => {
  const result = await client.db("admin").command({ ping: 1 });
  if (!result?.ok) throw new Error("Ping not ok");
}));

// 3. Server info
tally(await test("Server version", async () => {
  const info = await client.db("admin").command({ buildInfo: 1 });
  return info.version;
}));

// 4. Create test collection & insert
const db   = client.db("security_twin_test");
const coll = db.collection("conn_test");

tally(await test("Insert document", async () => {
  await coll.insertOne({ _id: "st-test-1", msg: "security-twin test", ts: new Date() });
}));

// 5. Find it back
tally(await test("Find document", async () => {
  const doc = await coll.findOne({ _id: "st-test-1" });
  if (!doc) throw new Error("Document not found");
  if (doc.msg !== "security-twin test") throw new Error(`Wrong msg: ${doc.msg}`);
  return `msg="${doc.msg}"`;
}));

// 6. Delete it
tally(await test("Delete document", async () => {
  const r = await coll.deleteOne({ _id: "st-test-1" });
  if (r.deletedCount !== 1) throw new Error("Nothing deleted");
}));

// 7. Drop test collection
tally(await test("Drop test collection", async () => {
  await coll.drop().catch(() => {}); // ignore if already gone
}));

await client.close();

summary("MongoDB", passed, failed);
if (failed > 0) process.exit(1);
