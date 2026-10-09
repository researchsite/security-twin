# Security Twin

An AI-powered security testing system. Clone this single repo to get everything:
a sample target app to attack, a reverse-proxy shield that intercepts payloads,
an LLM-powered attacker that generates them, a shared run-store, and a live
dashboard deployable to Vercel.

```
attacker/ ──→ shield/ ──→ demo-app/  (or your own app via TWIN_URL)
                 ↓
          orchestrator/
                 ↓
           dashboard/
```

---

## Monorepo structure

| Folder | Description |
|--------|-------------|
| `demo-app/` | Minimal Express + TypeScript API — the bundled sample target app. Contains a kit store with 6 fake kits owned by alice, bob, and carol, and a planted IDOR vulnerability on `GET /api/kits/:id`. In real use, point `TWIN_URL` at your own app instead. |
| `shield/` | Express + http-proxy-middleware reverse proxy — inspects every request and blocks detected attack patterns before forwarding to `TWIN_URL`. |
| `attacker/` | Node script using the OpenAI API — generates and fires attack payloads across 10 categories against the shield. |
| `orchestrator/` | Shared TypeScript types (`AttackEvent`, `RunSummary`) and in-memory run store used by the shield and dashboard. |
| `dashboard/` | Next.js 14 (App Router, TypeScript, Tailwind) — live-run page showing every hit and block in real time. Deployable to Vercel; shows a bundled recorded run by default (`DEMO_MODE=true`). |
| `rules/memory/` | Semgrep rules. `SEC-001.yaml` flags `getKit()` calls that skip the owner check. |

---

## Prerequisites

- Node 20+
- An `OPENAI_API_KEY` in `.env.local` (copy `.env.example` → `.env.local`)

---

## Quickstart — full local demo

```bash
# 1. Start the sample target app (port 3000)
cd demo-app && npm install && npm run dev

# 2. Start the shield (port 4000), proxying to the target
cd ../shield && npm install
TWIN_URL=http://localhost:3000 npm run dev

# 3. Fire attack payloads through the shield
cd ../attacker && npm install
SHIELD_URL=http://localhost:4000 npm run dev

# 4. Watch results in the dashboard (port 3002)
cd ../dashboard && npm install && npm run dev
```

Open `http://localhost:3002` — the dashboard streams every blocked and passed event.

---

## Running each piece individually

### demo-app (sample target)

```bash
cd demo-app
npm install
npm run dev        # ts-node, port 3000
# or: npm run build && npm start
```

```bash
# Test the IDOR vulnerability — alice reads bob's kit
curl -H "x-demo-user: alice" http://localhost:3000/api/kits/kit-bob-1
```

```bash
# Test the health check
curl http://localhost:3000/healthz
```

Docker:
```bash
docker build -t security-twin/demo-app demo-app/
docker run -p 3000:3000 security-twin/demo-app
```

### shield (reverse proxy)

```bash
cd shield
npm install
# Set TWIN_URL to the app you want to proxy (default: http://localhost:3000)
npm run dev        # ts-node
# or: npm run build && npm start
```

Default port: **4000**. Point `TWIN_URL` at your own app to use it as the real target.

### attacker

```bash
cd attacker
npm install
# Set SHIELD_URL (default http://localhost:4000) and OPENAI_API_KEY
npm run dev
```

Fires one round of payloads for each of 10 attack categories, then exits.

### orchestrator (build-time library)

```bash
cd orchestrator
npm install
npm run build      # outputs to dist/
```

Consumed as a local TypeScript path reference by the shield and dashboard.

### dashboard

```bash
cd dashboard
npm install
npm run dev        # http://localhost:3002
```

`DEMO_MODE=true` (the default) shows the bundled `public/demo-run.json`.
Set `DEMO_MODE=false` and `DASHBOARD_UNLOCK=<secret>` to enable the
"Launch live attack" button.

---

## Deploy to Vercel

The `dashboard/` folder is a self-contained Next.js app.

1. **Add New Project** in Vercel → import this repo → **Root Directory = `dashboard`**.
2. Vercel auto-detects Next.js; `dashboard/vercel.json` sets defaults.
3. Set these environment variables:

| Variable | Description |
|----------|-------------|
| `DEMO_MODE` | `true` for public visitors (recorded run only) |
| `DASHBOARD_UNLOCK` | Secret required to trigger a live run (leave blank for public deploy) |
| `SHIELD_URL` | URL of your running shield |
| `ORCHESTRATOR_URL` | URL of your running orchestrator |

> **Note:** The shield, attacker, orchestrator, and demo-app are long-running
> processes that cannot run on Vercel. Host them on Akash Network or locally
> and expose via a tunnel (e.g. ngrok, Cloudflare Tunnel).

---

## Semgrep rules

```bash
# Flag IDOR — getKit() calls that skip the owner check
semgrep --config rules/memory/SEC-001.yaml demo-app/src/
```

---

## Private folder

`_private/` is git-ignored and safe for PDD images, notes, and local files.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in values. Never commit `.env.local`.
