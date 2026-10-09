# Security Twin

An AI-powered security testing system that clones a target app behind a reverse proxy, then attacks it with LLM-generated payloads while a live dashboard tracks every hit and block.

```
attacker/ ──→ shield/ ──→ TWIN_URL (your app)
                 ↓
          orchestrator/
                 ↓
           dashboard/
```

---

## Monorepo structure

| Folder | Description |
|--------|-------------|
| `dashboard/` | Next.js (App Router, TypeScript, Tailwind) — live-run page, deployable to Vercel |
| `shield/` | Express + http-proxy-middleware reverse proxy — inspects & blocks attacks |
| `attacker/` | Node script using the OpenAI API — generates and fires attack payloads |
| `orchestrator/` | Shared TypeScript types and in-memory run store |

---

## Prerequisites

- Node 20+
- An `OPENAI_API_KEY` in `.env.local` (see `.env.example`)

---

## Running each piece

### 1. orchestrator (build only — consumed as a local lib)

```bash
cd orchestrator
npm install
npm run build
```

### 2. shield (reverse proxy)

```bash
cd shield
npm install
# Set TWIN_URL and SHIELD_PORT in ../.env.local or shell env
npm run dev        # ts-node
# or
npm run build && npm start
```

Default port: **4000**. Set `TWIN_URL` to the app you want to proxy (e.g. `http://localhost:3000`).

### 3. attacker

```bash
cd attacker
npm install
# Set SHIELD_URL (default http://localhost:4000) and OPENAI_API_KEY
npm run dev
```

The attacker fires one round of payloads for each attack category, then exits.

### 4. dashboard

```bash
cd dashboard
npm install
npm run dev      # http://localhost:3002
```

By default `DEMO_MODE=true` — the dashboard shows the bundled `public/demo-run.json` recorded run.  
Set `DEMO_MODE=false` + `DASHBOARD_UNLOCK=<secret>` to enable the "Launch live attack" button.

---

## Deploy to Vercel

The `dashboard/` folder is a self-contained Next.js app.

1. In Vercel: **Add New Project** → import this repo → **Root Directory = `dashboard`**.
2. Vercel will auto-detect Next.js; the `dashboard/vercel.json` sets defaults.
3. Set these environment variables in the Vercel dashboard:

| Variable | Description |
|----------|-------------|
| `DEMO_MODE` | `true` for public visitors (shows recorded run only) |
| `DASHBOARD_UNLOCK` | Secret key required to trigger a live run (keep blank for public deploy) |
| `SHIELD_URL` | URL of your running shield (not on Vercel — use Akash or local tunnel) |
| `ORCHESTRATOR_URL` | URL of your running orchestrator (same note) |

> **Note:** The shield, attacker, and orchestrator are long-running processes and cannot run on Vercel.  
> Run them on Akash Network or locally and expose via a tunnel (e.g. ngrok, Cloudflare Tunnel).

---

## Private folder

`_private/` is git-ignored and safe to use for PDD images, notes, and other local files.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in values. Never commit `.env.local`.
