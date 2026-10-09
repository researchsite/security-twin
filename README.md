# Security Twin

> **Find bugs before your attacker does.**
> An autonomous AI red-team that clones your app, attacks it, detects the breach with ClickHouse SQL, confirms it with Semgrep, applies a blast-radius-aware fix, and locks the pattern into CI — so the same bug can never come back.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/researchsite/security-twin&root=dashboard&env=DEMO_MODE&envDescription=Set%20DEMO_MODE%3Dtrue%20for%20the%20hosted%20demo%20replay)
&nbsp;
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it does

Security teams patch a vulnerability and move on. Two months later a new endpoint re-introduces the exact same pattern. **Security Twin breaks that cycle.**

1. It **clones** your app into an isolated workspace so nothing touches production
2. An **LLM attacker** (OpenAI, Nebius, or AkashML) fires real HTTP payloads through a reverse proxy shield
3. **ClickHouse** detects the attack signature across thousands of events in ~110ms with a single SQL query
4. **Semgrep** confirms the root cause in source code
5. The pipeline applies a **blast-radius-aware fix** (choosing between a non-breaking guard or a signature change based on how many callers exist)
6. A custom **Semgrep memory rule** is committed to CI — every future PR that repeats the pattern is blocked automatically

---

## Screenshots

### Dashboard — live run page
![Dashboard run page with 13 stages](docs/screenshots/run-page-final.png)

### Dashboard — home
![Security Twin dashboard home](docs/screenshots/dashboard-home.png)

### Target app — Kit Store (the demo IDOR target)
![Demo app Kit Store showing alice's kits with amber twin banner](docs/screenshots/demo-app-home.png)

### Live attacker feed — AkashML / Llama-3.3 attacking through the shield
![Live run attack stage showing LLM HTTP requests](docs/screenshots/live-run-attack-stage.png)

### All 13 stages complete
![All 13 pipeline stages shown in dashboard](docs/screenshots/run-all-13-stages.png)

---

## How it works

```
  Browser ──SSE stream──▶ Dashboard (Next.js :3001)
                               │
                    POST /run/start
                               │
                               ▼
                     Orchestrator (:4001)
                      13-stage pipeline
                               │
       ┌───────────────────────┼──────────────────────────┐
       │                       │                          │
       ▼                       ▼                          ▼
  [1] clone             [4] traffic              [8] remember
  [2] scan          ──▶ Shield (:8080) ──▶  [5] detect (ClickHouse)
  [3] attack            Reverse proxy           [6] map
  (LLM agent)           + decoys               [7] confirm (Semgrep)
                        + rate-flag             [9] fix
                        + ClickHouse sink      [10] prove
                                               [11] sync (GitHub PR)
                                               [12] alert (Guava call)
                                               [13] brief (ElevenLabs TTS)
       │
       ▼
  Demo-app (:3000)   ClickHouse Cloud    MongoDB Atlas
  (target twin)      (request logs)      (security memory)
```

---

## The 13-stage pipeline

| # | Stage | What happens |
|---|-------|-------------|
| 1 | **clone** | Copy the target app into `/tmp/runs/{id}` — isolated per run, never touches source |
| 2 | **scan** | Semgrep + Plumber static analysis baseline; establishes `score_before` |
| 3 | **attack** | LLM agent fires HTTP payloads through the shield; writes a findings report |
| 4 | **traffic** | Flood the shield at 640+ req/s for 25s; generates 6,000–16,000 ClickHouse rows |
| 5 | **detect** | Single SQL on `requests_kit_enum` AggregatingMergeTree MV; ~110ms for ≥3 kit IDs/IP |
| 6 | **map** | Locate the exact vulnerable source file via filename match, grep, or LLM fallback |
| 7 | **confirm** | Re-run Semgrep with the targeted memory rule — confirms root cause in code |
| 8 | **remember** | Upsert finding + embedding to MongoDB; save attacker confession |
| 9 | **fix** | Blast-radius analysis → pick fix type → apply patch → restart twin |
| 10 | **prove** | HTTP probes against live patched twin — cross-user 404, own-user 200 |
| 11 | **sync** | GitHub REST API: branch + 3-file commit + draft PR on your fork |
| 12 | **alert** | Guava outbound voice call to on-call; yes/no IVR approval _(optional)_ |
| 13 | **brief** | LLM summary → ElevenLabs TTS → 60s audio brief _(optional)_ |

---

## Fix analysis — non-breaking vs signature change

The fix stage does **not** blindly patch the vulnerable line. It runs a four-step analysis:

**Step 1 — Blast-radius scan**: walks the entire work-copy source tree and finds every call site of the vulnerable function.

**Step 2 — Arity detection**: automatically detects whether the safer alternative requires a function signature change (more arguments = breaking change for all callers).

**Step 3 — Safety gate**: if a signature change is requested but there are multiple callers or the caller cannot supply the new argument, the pipeline pauses and emits a `needs_decision` event. The dashboard shows a decision widget. The engineer POSTs their choice to `/api/runs/:id/decide`. Timeout defaults to the safe non-breaking option.

**Step 4 — Two fix options**:

| Option | What it does | Blast radius | Auto-applied? |
|--------|-------------|-------------|---------------|
| **non-breaking** _(default)_ | Widens the null guard: `if (!kit \|\| kit.ownerId !== currentUser(req))` | Zero — no signature change | Always |
| **signature change** | Replaces `getKit(id)` → `getKitForUser(id, userId)` | All callers of `getKit` | Only when safe (1 caller, user in scope) |

```diff
# Non-breaking fix (default — zero blast radius)
- const kit = getKit(req.params.id); // IDOR: no owner check
+ const kit = getKit(req.params.id);
- if (!kit) {
+ if (!kit || kit.ownerId !== currentUser(req)) {

# Signature-change fix (alternative — breaks callers)
- const kit = getKit(req.params.id); // IDOR: no owner check
+ const kit = getKitForUser(req.params.id, currentUser(req));
```

After patching, Semgrep re-runs to confirm `score_before=1 → score_after=0`.

---

## Supported LLM providers

| `LLM_PROVIDER` | Key env var | Default model | API mode |
|---------------|-------------|--------------|----------|
| `openai` _(default)_ | `OPENAI_API_KEY` | `gpt-4o` | Responses API (stateful) |
| `akash` | `AKASHML_API_KEY` | `meta-llama/Llama-3.3-70B-Instruct` | Chat Completions |
| _(custom)_ | `ATTACKER_API_KEY` | set `ATTACKER_MODEL` | Chat Completions via `ATTACKER_BASE_URL` |

Flip providers without restarting the agent — just change `LLM_PROVIDER` in `.env.local` and restart the orchestrator.

Verify AkashML before the demo:
```bash
node scripts/check-akash.mjs
# ✓ chat completion (1 message) — model="meta-llama/Llama-3.3-70B-Instruct"
# ✓ tool-call support (function calling)
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| **Attacker LLM** | OpenAI GPT-4o · AkashML Llama-3.3-70B · Nebius Qwen3-30B |
| **Detection** | ClickHouse Cloud — AggregatingMergeTree MVs, single SQL detect query |
| **Static analysis** | Semgrep — scan, confirm, memory rule enforcement in CI |
| **Memory** | MongoDB Atlas — findings, embeddings, run history, confessions |
| **Voice alert** | Guava — outbound IVR call, yes/no approval collection |
| **Audio brief** | ElevenLabs — TTS from LLM run summary |
| **CI gate** | GitHub Actions `twin-gate.yml` — memory rules block PRs |
| **Dashboard** | Next.js 14 · Tailwind · SSE live events |
| **Services** | Express · TypeScript end-to-end |
| **Shield proxy** | Express + http-proxy-middleware · decoy routes · rate flagging |

---

## Monorepo layout

```
security-twin/
├── demo-app/           Target app — Express + TypeScript with planted IDOR (CWE-639)
├── shield/             Reverse proxy — session tracking, ClickHouse sink, decoys
│   └── src/
│       ├── index.ts    Session middleware, x-run-id tagging, decoy routes
│       └── ch-sink.ts  AggregatingMergeTree batch sink (10K rows / 500ms)
├── attacker/           LLM attacker — OpenAI Responses API or Chat Completions
│   └── src/
│       └── agent.ts    Single http_request tool, host-pinned to shield, 40-req budget
├── orchestrator/       Pipeline runner — 13 stages, SSE event bus, MongoDB memory
│   └── src/
│       ├── server.ts   Express API (/run/start, /api/runs/:id/stream)
│       ├── pipeline.ts Stage runner, in-memory event registry, saveRun()
│       ├── memory.ts   MongoDB wrapper (connect, remember, saveRun, recall)
│       └── stages/     One file per stage (clone, scan, attack, … brief)
├── dashboard/          Next.js dashboard — live run, memory page, audio player
│   └── src/app/
│       ├── page.tsx                  Home — repo URL input, start run
│       ├── runs/[id]/RunPage.tsx     Live SSE run page
│       └── api/runs/[id]/stream/     Node.js http.request SSE proxy
├── rules/
│   └── memory/
│       └── idor.yaml   SEC-001 — IDOR/CWE-639 Semgrep rule (auto-generated)
├── scripts/
│   ├── start-all.sh    Start all 4 services in order with health checks
│   ├── stop-all.sh     Graceful stop + port cleanup
│   ├── demo.sh         One-command demo (--live or --dry)
│   ├── status.sh       Show service health and recent log tails
│   ├── reset-run.mjs   Delete /tmp/runs/*, truncate ClickHouse, optionally wipe MongoDB
│   └── check-akash.mjs Verify AkashML key + tool-call support before demo
├── .github/
│   └── workflows/
│       └── twin-gate.yml  PR gate: Semgrep auto (info) + memory rules (blocking)
├── .env.example        All supported env vars with descriptions
└── docs/
    └── screenshots/    README images
```

---

## Prerequisites

- **Node.js 20+**
- **Git Bash** (Windows) or any POSIX shell for the scripts
- Copy `.env.example` → `.env.local` and fill in your keys

### Minimum keys for a live run

```env
# One LLM provider
OPENAI_API_KEY=          # OR
AKASHML_API_KEY=         # + set LLM_PROVIDER=akash

# ClickHouse (Cloud or self-hosted)
CLICKHOUSE_URL=https://your-instance.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=

# MongoDB Atlas (or local mongodb://)
MONGODB_URL=mongodb+srv://user:pass@cluster.mongodb.net/

# Shield + twin URLs (defaults shown)
TWIN_URL=http://localhost:3000
SHIELD_URL=http://localhost:8080
```

### Optional keys — each feature degrades gracefully

```env
ELEVENLABS_API_KEY=      # TTS audio brief (brief stage)
ELEVENLABS_VOICE_ID=

PHONE_ALERTS=true        # Guava voice call (alert stage)
ON_CALL_NUMBER=+1...
GUAVA_API_KEY=
GUAVA_AGENT_NUMBER=

GITHUB_TOKEN=            # sync stage — creates PR on your fork
GITHUB_FORK=owner/repo

RECORD_DEMO_RUN=true     # save live run as the new demo-run.json baseline
```

---

## Quickstart

### Option A — Demo mode (no keys needed)

Replays a recorded real run with no backend required:

```bash
git clone https://github.com/researchsite/security-twin.git
cd security-twin/dashboard
npm install
DEMO_MODE=true npx next dev -p 3001
# open http://localhost:3001 → click "demo run"
```

### Option B — Full live run

```bash
git clone https://github.com/researchsite/security-twin.git
cd security-twin

# 1. Set up env
cp .env.example .env.local
# fill in OPENAI_API_KEY (or AKASHML_API_KEY + LLM_PROVIDER=akash),
# CLICKHOUSE_*, MONGODB_URL

# 2. Start all four services
bash scripts/start-all.sh
#  demo-app   → http://localhost:3000
#  shield     → http://localhost:8080
#  orchestrator → http://localhost:4001
#  dashboard  → http://localhost:3001

# 3. Run the pipeline
bash scripts/demo.sh --live
# or: curl -X POST http://localhost:4001/run/start

# 4. Watch it live
open http://localhost:3001

# 5. Stop everything
bash scripts/stop-all.sh
```

---

## Start and stop

### Start all services

```bash
bash scripts/start-all.sh
```

What it does:
1. Sources `.env.local`
2. Installs deps in each package (once)
3. Starts services in dependency order with health-check polling:
   - `demo-app` (:3000) → `shield` (:8080) → `orchestrator` (:4001) → `dashboard` (:3001)
4. PIDs written to `scripts/.pids/`; logs written to `scripts/.logs/`

### Check status

```bash
bash scripts/status.sh
# Shows: running/stopped per service, last 10 log lines each
```

### Reset between runs

```bash
node scripts/reset-run.mjs              # delete /tmp/runs/*, truncate ClickHouse tables
node scripts/reset-run.mjs --clear-mongo  # also wipe MongoDB runs/findings
```

### Stop all services

```bash
bash scripts/stop-all.sh
```

---

## Running services individually

### demo-app (port 3000)

```bash
cd demo-app && npm install
PORT=3000 npx ts-node src/index.ts
```

The planted IDOR is on `GET /api/kits/:id` — `getKit(id)` with no owner check. Users: `alice`, `bob`, `carol` (set via `x-demo-user` header).

### shield (port 8080)

```bash
cd shield && npm install
SHIELD_PORT=8080 TWIN_URL=http://localhost:3000 npx ts-node src/index.ts
```

Proxies to `TWIN_URL`. Decoy routes (`/admin-backup/`, `/api/internal/export`) flag sessions. ClickHouse sink batches 10,000 rows per 500ms flush.

### attacker

```bash
cd attacker && npm install
LLM_PROVIDER=akash SHIELD_URL=http://localhost:8080 npx ts-node src/agent.ts
# or dry-run (no API key needed):
npx ts-node src/agent.ts --dry
```

### orchestrator (port 4001)

```bash
cd orchestrator && npm install
PORT=4001 REPO_ROOT=$(pwd)/.. npx ts-node src/server.ts
```

Key endpoints:
- `POST /run/start` — triggers a new 13-stage pipeline run
- `GET /api/runs/:id/stream` — SSE stream of all run events
- `POST /api/runs/:id/decide` — human fix-type decision (`{ choice: "non_breaking" | "signature_change" }`)
- `GET /healthz` — health check

### dashboard (port 3001)

```bash
cd dashboard && npm install
DEMO_MODE=false ORCHESTRATOR_URL=http://localhost:4001 npx next dev -p 3001
```

Pages:
- `/` — home, start a run
- `/runs/:id` — live SSE run page (attacker feed, ClickHouse detection, findings, fix diff, audio player)
- `/memory` — security knowledge base from MongoDB
- `/runs/demo` — demo run replay

---

## Vercel deployment (dashboard only)

The dashboard is stateless and deploys to Vercel in `DEMO_MODE=true` — it replays the bundled `public/demo-run.json` with no backend needed.

```bash
cd security-twin
vercel --cwd dashboard --prod
```

Or one-click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/researchsite/security-twin&root=dashboard&env=DEMO_MODE&envDescription=Set%20DEMO_MODE%3Dtrue%20for%20the%20public%20demo%20replay)

**Vercel project settings:**

| Setting | Value |
|---------|-------|
| Root directory | `dashboard` |
| Build command | `next build` |
| Output directory | `.next` |
| `DEMO_MODE` | `true` |
| `ORCHESTRATOR_URL` | `https://your-orchestrator.example.com` _(only if running live)_ |

---

## CI gate — Twin Gate

`.github/workflows/twin-gate.yml` runs on every pull request:

| Step | Blocking? | What it checks |
|------|-----------|---------------|
| Semgrep auto | No | `--config auto` on `demo-app/src/` — findings become PR annotations |
| **Semgrep memory** | **Yes** | `--config rules/memory/` — zero tolerance, PR fails if SEC-001 pattern detected |
| Plumber | No | CI/CD security scan — skipped gracefully if binary not available |

**Demo the gate live:**

```bash
git push origin demo/idor-regression
# Open PR: demo/idor-regression → master on GitHub
# Twin Gate will FAIL — SEC-001 flags the re-introduced export endpoint
```

The `demo/idor-regression` branch re-introduces `GET /api/kits/:id/export` which calls `getKit(id)` without an owner check — exactly the pattern the memory rule forbids.

---

## Safety design

| Principle | Implementation |
|-----------|---------------|
| **Attack only the twin** | Attacker is hard-coded to `SHIELD_URL`; code rejects any other host at runtime |
| **Isolated workspace** | Every run writes to `/tmp/runs/{run_id}` only; fix stage throws `ISOLATION VIOLATION` if path escapes |
| **Non-breaking default** | Fix defaults to the in-handler guard (zero blast radius); signature changes require explicit opt-in |
| **PR-only sync** | Sync stage opens a draft PR — never force-pushes or touches `main` |
| **Graceful degradation** | Missing key → demo fallback; ClickHouse down → demo detect result; Guava fails → pipeline continues |
| **Secrets never committed** | `.env.local` and `_private/` are git-ignored; `.env.example` has no real values |

---

## Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `openai` | `openai` or `akash` |
| `OPENAI_API_KEY` | — | OpenAI key (attack + brief + embed stages) |
| `AKASHML_API_KEY` | — | AkashML key (when `LLM_PROVIDER=akash`) |
| `ATTACKER_MODEL` | provider default | Override model (e.g. `deepseek-ai/DeepSeek-R1`) |
| `NEBIUS_API_KEY` | — | Nebius AI key (alternative provider) |
| `NEBIUS_BASE_URL` | `https://api.studio.nebius.com/v1/` | Nebius endpoint |
| `CLICKHOUSE_URL` | — | ClickHouse HTTP(S) endpoint |
| `CLICKHOUSE_USER` | `default` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | — | ClickHouse password |
| `MONGODB_URL` | — | MongoDB connection string (`mongodb+srv://…`) |
| `MONGODB_DB` | `security_twin` | Database name |
| `TWIN_URL` | `http://localhost:3000` | URL of the target twin app |
| `SHIELD_URL` | `http://localhost:8080` | URL of the shield proxy |
| `SHIELD_PORT` | `8080` | Port the shield listens on |
| `ORCHESTRATOR_URL` | `http://localhost:4001` | Dashboard → orchestrator URL |
| `DEMO_MODE` | `false` | `true` = replay demo-run.json, no backend needed |
| `RECORD_DEMO_RUN` | `false` | `true` = write live run events to demo-run.json |
| `PHONE_ALERTS` | `false` | `true` = enable Guava voice call in alert stage |
| `ON_CALL_NUMBER` | — | Phone number for Guava call |
| `GUAVA_API_KEY` | — | Guava API key |
| `GUAVA_AGENT_NUMBER` | — | Guava agent phone number |
| `ELEVENLABS_API_KEY` | — | ElevenLabs key for TTS audio brief |
| `ELEVENLABS_VOICE_ID` | — | ElevenLabs voice ID |
| `GITHUB_TOKEN` | — | PAT scoped to your fork (sync stage) |
| `GITHUB_FORK` | — | `owner/repo` of your fork |

---

## License

MIT
