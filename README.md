# Security Twin

> An AI red-team that finds, fixes, and remembers — so the same attack can't work twice.

Security teams patch vulnerabilities and move on. Two months later, a new endpoint re-introduces the same pattern. Security Twin breaks the cycle: after a confirmed finding it stores a Semgrep rule in `rules/memory/` and locks it into CI. Any future PR that repeats the pattern is blocked before it ships.

---

## How it works

```
attacker/ ──→ shield/ ──→ demo-app/   (or your own app via TWIN_URL)
                 │
                 ▼
           orchestrator/   13-stage pipeline
                 │
                 ▼
           dashboard/      live SSE stream  →  Vercel
```

A 13-stage pipeline runs end-to-end:

| # | Stage | What happens |
|---|-------|-------------|
| 1 | **clone** | Copy the target app into an isolated work dir |
| 2 | **scan** | Semgrep + Plumber static analysis baseline |
| 3 | **attack** | LLM-powered attacker fires payloads through the shield |
| 4 | **traffic** | Flood the clone to generate realistic request logs in ClickHouse |
| 5 | **detect** | ClickHouse SQL window query finds IDOR enumeration patterns |
| 6 | **map** | Locate the exact source file and vulnerable method |
| 7 | **confirm** | Re-run Semgrep with targeted memory rule to confirm the finding |
| 8 | **remember** | LLM attacker confesses its objective; persist confession to MongoDB |
| 9 | **fix** | Analyse blast radius, choose fix type, patch source, restart twin |
| 10 | **prove** | Re-run IDOR probes against the patched twin; verify 404s |
| 11 | **sync** | Commit patched file + memory rule + CI workflow to GitHub fork; open PR |
| 12 | **alert** | Guava outbound phone call to on-call engineer for yes/no approval |
| 13 | **brief** | LLM summary → ElevenLabs TTS audio brief |

The dashboard streams every event live via SSE. Set `DEMO_MODE=true` to replay `dashboard/public/demo-run.json` with no backend needed.

---

## Monorepo layout

```
security-twin/
├── demo-app/          Target app — Express + TypeScript kit store with planted IDOR
├── shield/            Reverse proxy — inspects, blocks, injects decoys
├── attacker/          LLM attacker — generates + fires payloads
├── orchestrator/      Pipeline runner — 13 stages, SSE event bus, MongoDB memory
├── dashboard/         Next.js dashboard — live run page, memory page, audio brief
├── rules/
│   └── memory/        Semgrep rules written by the twin after each confirmed finding
│       └── SEC-001.yaml  IDOR kit-read without owner check (CWE-639)
├── scripts/           start-all.sh / stop-all.sh / demo.sh / status.sh
├── .github/
│   └── workflows/
│       └── twin-gate.yml  PR gate: Semgrep auto (info) + memory rules (blocking)
└── _private/          Local-only files — git-ignored
```

---

## Each tool's role

| Tool | Role in Security Twin |
|------|----------------------|
| **OpenAI / Nebius** | LLM attacker (attack stage) and run summariser (brief stage) |
| **Semgrep** | Static analysis baseline (scan) + confirmation (confirm) + memory rule enforcement in CI (twin-gate) |
| **ClickHouse** | Time-series store for every shield request; IDOR enumeration detected by SQL window query |
| **MongoDB** | Persistent memory — stores each confirmed finding, attacker confession, fix invariant |
| **Guava** | Outbound voice call to on-call engineer; collects yes/no fix approval (alert stage) |
| **ElevenLabs** | Text-to-speech audio brief from the LLM run summary (brief stage) |
| **GitHub REST API** | Creates branch, commits patched file + memory rule + CI workflow, opens PR (sync stage) |

---

## Safety design

Security Twin is built to test a **clone**, never your production system.

| Principle | Implementation |
|-----------|---------------|
| **Twin banner** | `demo-app` renders a fixed amber banner. If you point `TWIN_URL` at your own app, keep this visual indicator so it's clear which instance is under attack. |
| **Attack only the twin** | The attacker fires at `SHIELD_URL` (default `:8080`), never directly at your app. The shield proxies to `TWIN_URL`. |
| **Passive shield** | The shield detects and counts attacks but does not alter your production data. It injects decoy responses to mislead the attacker, not to disrupt real users. |
| **Careful fix** | The fix stage analyses blast radius (callers of the unsafe function) before patching. A signature change with high blast radius triggers a human decision gate that pauses the pipeline. |
| **PR-only sync** | The sync stage opens a pull request on your fork — it never force-pushes or touches `main` directly. The `GITHUB_TOKEN` is scoped to the fork only. |
| **Env isolation** | `.env.local` and all `.env*` variants are git-ignored. The `_private/` folder is also git-ignored. No secret is ever committed. |
| **Memory rule CI gate** | Once a vulnerability class is patched, its Semgrep rule is committed and wired into `twin-gate.yml`. Every future PR runs the gate — the same pattern can never re-enter the codebase. |
| **Phone alert optional** | The Guava alert stage is gated by `PHONE_ALERTS=true`. A failed or skipped call never blocks the pipeline. |

---

## Prerequisites

- Node 20+
- `.env.local` at the repo root (copy `.env.example` → `.env.local`)

**Minimum keys for a live run:**

```
OPENAI_API_KEY=          # or set NEBIUS_API_KEY + NEBIUS_BASE_URL
CLICKHOUSE_HOST=
CLICKHOUSE_USER=
CLICKHOUSE_PASSWORD=
MONGODB_URI=
GITHUB_TOKEN=            # scoped to your fork only
GITHUB_FORK=owner/repo
```

**Optional — each feature degrades gracefully without it:**

```
ELEVENLABS_API_KEY=      # audio brief
ELEVENLABS_VOICE_ID=
PHONE_ALERTS=true        # Guava voice alert
ON_CALL_NUMBER=+1...
GUAVA_API_KEY=
GUAVA_AGENT_NUMBER=
RECORD_DEMO_RUN=true     # overwrite demo-run.json after a real run
```

---

## Quickstart — demo mode (no keys required)

```bash
bash _private/demo-start.sh
# Opens http://localhost:3001
# Replays dashboard/public/demo-run.json — no backend, no attacker
```

---

## Quickstart — full local run

```bash
# 1. Copy and fill env
cp .env.example .env.local

# 2. Start all services (demo-app :3000, shield :8080, orchestrator :4001, dashboard :3001)
bash scripts/start-all.sh

# 3. Trigger a live pipeline run
bash scripts/demo.sh --live

# 4. Stop everything
bash scripts/stop-all.sh
```

---

## Recording a real run as the new demo

Set `RECORD_DEMO_RUN=true`. When the pipeline finishes, the full event stream is written to `dashboard/public/demo-run.json` and replayed automatically in demo mode.

```bash
RECORD_DEMO_RUN=true bash scripts/demo.sh --live
```

---

## Running each piece individually

### demo-app (port 3000)

```bash
cd demo-app && npm install
PORT=3000 npx ts-node src/index.ts
```

Intentional IDOR on `GET /api/kits/:id` — the planted vulnerability the twin finds. The three users are `alice`, `bob`, `carol` (set via `x-demo-user` header). After SEC-001 is patched the route uses `getKitForUser(id, currentUser(req))`.

### shield (port 8080)

```bash
cd shield && npm install
SHIELD_PORT=8080 TWIN_URL=http://localhost:3000 npx ts-node src/index.ts
```

### attacker

```bash
cd attacker && npm install
SHIELD_URL=http://localhost:8080 npx ts-node agent.ts
```

Requires `OPENAI_API_KEY` or Nebius credentials.

### orchestrator (port 4001)

```bash
cd orchestrator && npm install   # .npmrc sets legacy-peer-deps automatically
PORT=4001 REPO_ROOT=$(pwd)/.. npx ts-node src/server.ts
```

`POST /run/start` starts the 13-stage pipeline. `GET /api/runs/:id/stream` streams SSE events.

### dashboard (port 3001)

```bash
cd dashboard && npm install
DEMO_MODE=false ORCHESTRATOR_URL=http://localhost:4001 npx next dev -p 3001
```

Live run page at `/runs/:id`. Memory page at `/memory`. Set `DEMO_MODE=true` to replay `public/demo-run.json` without a backend.

---

## Vercel deployment

Deploy the dashboard to Vercel with **root directory = `dashboard/`**.

| Vercel env var | Value |
|----------------|-------|
| `ORCHESTRATOR_URL` | `https://your-orchestrator.example.com` |
| `DEMO_MODE` | `true` for the public demo replay |

The dashboard is stateless. In `DEMO_MODE` it replays the bundled JSON with no backend.

---

## Twin Gate — CI enforcement

`.github/workflows/twin-gate.yml` runs on every pull request via the `semgrep/semgrep` Docker image:

| Step | Blocking? | Detail |
|------|-----------|--------|
| Semgrep auto | No | `--config auto` on `demo-app/src/` — findings become PR annotations |
| Semgrep memory | **Yes** | `--config rules/memory/` — zero tolerance, PR fails with SEC-001 link |
| Plumber | No | `plumber scan . --min-score B` — skipped with a warning if binary absent |

**To demo the gate live:**

```bash
git remote add origin https://github.com/YOUR_FORK/security-twin.git
git push origin master
git push origin demo/idor-regression
# open PR: demo/idor-regression → master
# twin-gate/Semgrep memory rules will FAIL and annotate the export endpoint
```

The `demo/idor-regression` branch adds `GET /api/kits/:id/export` which calls `getKit(id)` without an owner check — the exact pattern SEC-001 forbids.

---

## Memory rule format

```yaml
# rules/memory/SEC-001.yaml
rules:
  - id: SEC-001-idor-getkit-no-owner-check
    message: >
      getKit(id) returns a kit with NO owner check — IDOR / CWE-639 / OWASP A01.
      Fix: replace with getKitForUser(id, currentUser(req)).
    severity: ERROR
    languages: [typescript, javascript]
    patterns:
      - pattern: getKit($ID)
      - pattern-not: getKit($ID, ...)
```

The `sync` stage commits this rule, the patched source, and `twin-gate.yml` to your fork as a single PR. Once merged, the invariant is enforced on every future PR automatically.

---

## Architecture images

<!-- Drop images from _private/ here -->

---

## License

MIT
