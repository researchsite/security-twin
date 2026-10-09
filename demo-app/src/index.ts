import "dotenv/config";
import express, { Request, Response } from "express";
import { getKit, getKitForUser, listKitsForUser, USERS } from "./kits";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const app = express();
app.use(express.json());

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reads the current user from the x-demo-user header. Defaults to "alice". */
function currentUser(req: Request): string {
  return (req.headers["x-demo-user"] as string | undefined) ?? "alice";
}

const HTML_SHELL = (title: string, body: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex">
  <title>${title}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:700px;margin:2rem auto;padding:0 1rem;background:#0f172a;color:#e2e8f0}
    .banner{position:fixed;top:0;left:0;right:0;background:#f59e0b;color:#000;text-align:center;padding:6px;font-weight:700;font-size:.85rem;letter-spacing:.05em}
    .content{margin-top:3rem}
    table{width:100%;border-collapse:collapse;font-size:.9rem}
    th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #1e293b}
    th{color:#94a3b8}
    .token{font-family:monospace;color:#60a5fa}
    h1{color:#f8fafc}a{color:#60a5fa}
  </style>
</head>
<body>
  <div class="banner">Security twin — sample target app</div>
  <div class="content">${body}</div>
</body>
</html>`;

// ── Routes ────────────────────────────────────────────────────────────────────

// Home — lists the current user's kits
app.get("/", (req: Request, res: Response) => {
  const user = currentUser(req);
  const kits = listKitsForUser(user);
  const rows = kits
    .map(
      (k) =>
        `<tr>
          <td><a href="/api/kits/${k.id}">${k.id}</a></td>
          <td>${k.title}</td>
          <td>${k.repoName}</td>
          <td class="token">${k.token.slice(0, 16)}…</td>
        </tr>`
    )
    .join("");

  const body = `
    <h1>Kit Store</h1>
    <p>Logged in as <strong>${user}</strong>
       &nbsp;·&nbsp; <em>(set via <code>x-demo-user</code> header)</em></p>
    ${
      kits.length
        ? `<table><thead><tr><th>ID</th><th>Title</th><th>Repo</th><th>Token</th></tr></thead>
           <tbody>${rows}</tbody></table>`
        : "<p>No kits found for this user.</p>"
    }
    <hr style="margin-top:2rem;border-color:#1e293b">
    <p style="font-size:.8rem;color:#64748b">
      This is the bundled sample target for the security-twin demo.
      In real use you point the tool at your own app.
    </p>`;

  res.send(HTML_SHELL("Kit Store", body));
});

// About page — a second harmless HTML route to make the app feel real
app.get("/about", (_req: Request, res: Response) => {
  const body = `
    <h1>About Kit Store</h1>
    <p>A minimal demo app bundled with the
       <a href="https://github.com/your-org/security-twin">security-twin</a> toolchain.</p>
    <ul>
      <li>Three users: ${USERS.join(", ")}</li>
      <li>Six kits total, two per user</li>
      <li>Tokens are always <code>ghp_FAKE_…</code> — no real secrets</li>
    </ul>
    <p><a href="/">← Back to kit list</a></p>`;
  res.send(HTML_SHELL("About", body));
});

// Health check
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// List the current user's kits
app.get("/api/kits", (req: Request, res: Response) => {
  const user = currentUser(req);
  res.json(listKitsForUser(user));
});

// List known users (harmless reference endpoint)
app.get("/api/users", (_req: Request, res: Response) => {
  res.json(USERS);
});

// GET /api/kits/:id — patched by Security Twin (SEC-001)
//
// Original vulnerability: getKit(id) with no owner check (IDOR / CWE-639).
// Fix applied: replaced with getKitForUser(id, currentUser(req)) so only the
// owning user can access a kit.  SEC-001 memory rule enforces this invariant
// in CI — any PR that re-introduces getKit(id) will be blocked by twin-gate.
app.get("/api/kits/:id", (req: Request, res: Response) => {
  const kit = getKitForUser(req.params.id, currentUser(req)); // SEC-001 fix
  if (!kit) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(kit);
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[demo-app] Listening on :${PORT}`);
});
