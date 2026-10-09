# demo-app

A minimal Express + TypeScript API bundled with the security-twin toolchain as a
ready-made **sample target**. It plays the role of "a small company's internal kit
management service" so you can run a full demo without needing a real app to attack.

> **In real use** you point `TWIN_URL` at your own app instead.

---

## What it contains

| File | Purpose |
|------|---------|
| `src/kit-store.ts` | In-memory store: 6 fake kits owned by alice (×2), bob (×2), carol (×2). All tokens are `ghp_FAKE_…` — no real secrets. |
| `src/kits.ts` | `getKit(id)` — no owner check (intentionally unsafe) · `getKitForUser(id, userId)` — safe version |
| `src/index.ts` | Express routes (see below) |

## Routes

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/` | HTML home — lists the current user's kits |
| `GET` | `/about` | HTML about page |
| `GET` | `/healthz` | `{"status":"ok"}` |
| `GET` | `/api/kits` | JSON list for the current user (`x-demo-user` header) |
| `GET` | `/api/kits/:id` | **IDOR** — returns any kit by ID with no owner check |
| `GET` | `/api/users` | Lists the three demo user names |

The current user is read from the `x-demo-user` HTTP header (defaults to `alice`).

### The planted vulnerability

`GET /api/kits/:id` calls `getKit(id)` which has **no owner check**. A caller who
knows or guesses a kit ID belonging to another user gets that kit's details —
including the (fake) token. This is a classic **IDOR (CWE-639 / OWASP A01)**.

The Semgrep rule at `../rules/memory/SEC-001.yaml` flags `getKit(` calls in code
reviews. The shield's IDOR detector flags cross-user ID probes at runtime.

---

## Running locally

```bash
cd demo-app
npm install
npm run dev    # ts-node, port 3000

# Switch user via header
curl -H "x-demo-user: bob" http://localhost:3000/api/kits
# IDOR probe — alice reading bob's kit
curl -H "x-demo-user: alice" http://localhost:3000/api/kits/kit-bob-1
```

## Running with Docker

```bash
docker build -t security-twin/demo-app .
docker run -p 3000:3000 security-twin/demo-app
```

## Running as the twin target

Set `TWIN_URL=http://localhost:3000` in the root `.env.local`, then start the
shield on port 4000. The attacker will probe through the shield → demo-app.

```bash
# Terminal 1 — target
cd demo-app && npm run dev

# Terminal 2 — shield
cd shield && TWIN_URL=http://localhost:3000 npm run dev

# Terminal 3 — attacker (fires payloads at the shield)
cd attacker && SHIELD_URL=http://localhost:4000 npm run dev
```
