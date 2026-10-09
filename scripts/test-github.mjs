import { Octokit } from "@octokit/rest";
import { loadEnv, header, test, summary } from "./_env.mjs";

loadEnv();

const token = process.env.GITHUB_TOKEN;

header("GitHub token test");

if (!token) {
  console.error("  ✗  GITHUB_TOKEN not set in .env.local");
  process.exit(1);
}

console.log(`  Token: ghp_...${token.slice(-4)}\n`);

const octokit = new Octokit({ auth: token });
let passed = 0, failed = 0;

function tally(r) { passed += r.passed; failed += r.failed; }

// 1. Authenticated user
let login = "";
tally(await test("Authenticated user", async () => {
  const { data } = await octokit.users.getAuthenticated();
  login = data.login;
  return `login=${data.login}  type=${data.type}`;
}));

// 2. Rate limit
tally(await test("Rate limit", async () => {
  const { data } = await octokit.rateLimit.get();
  const core = data.resources.core;
  return `${core.remaining}/${core.limit} remaining`;
}));

// 3. List repos (first 5)
tally(await test("List repos", async () => {
  const { data } = await octokit.repos.listForAuthenticatedUser({
    per_page: 5,
    sort:     "updated",
  });
  return `${data.length} repos (first page)`;
}));

// 4. Token scopes (from response header)
tally(await test("Token scopes", async () => {
  const res = await octokit.request("GET /user");
  const scopes = res.headers["x-oauth-scopes"] ?? "(not shown)";
  return `scopes: ${scopes}`;
}));

summary("GitHub", passed, failed);
if (failed > 0) process.exit(1);
