// take-screenshots.mjs — fresh screenshots from the live Vercel demo run
// Usage: node take-screenshots.mjs

import puppeteer from "puppeteer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "screenshots");
fs.mkdirSync(OUT, { recursive: true });

const DEMO_RUN = "https://dashboard-sigma-sable-28.vercel.app/runs/demo-2024-idor";
const HOME     = "https://dashboard-sigma-sable-28.vercel.app";

function save(page, file, opts = {}) {
  return page.screenshot({ path: path.join(OUT, file), type: "png", ...opts })
    .then(() => {
      const kb = Math.round(fs.statSync(path.join(OUT, file)).size / 1024);
      console.log(`  ✓ ${file} (${kb}KB)`);
    });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // ── 01 — Target app (Kit Store) ── use existing real screenshot ───────────
  const kitSrc = path.join(OUT, "demo-app-home.png");
  if (fs.existsSync(kitSrc)) {
    fs.copyFileSync(kitSrc, path.join(OUT, "01-target-app-idor-bug.png"));
    console.log(`  ✓ 01-target-app-idor-bug.png (copied from demo-app-home.png)`);
  }

  // ── 02 — Dashboard home (1280×720) ────────────────────────────────────────
  const pg1 = await browser.newPage();
  await pg1.setViewport({ width: 1280, height: 720 });
  console.log("\n[02] Dashboard home...");
  await pg1.goto(HOME, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));
  await save(pg1, "02-dashboard-home.png");
  await pg1.close();

  // ── Open demo run page at 1440×900 — wait for full SSE replay ────────────
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  console.log("\n[loading] Demo run page at 1440×900...");
  await pg.goto(DEMO_RUN, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 6000)); // let SSE replay finish

  // ── 03 — Full viewport: stages sidebar + attacker + ClickHouse + findings ─
  console.log("\n[03] Full pipeline overview (1440×900 viewport top)...");
  await pg.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 300));
  await save(pg, "03-pipeline-all-13-stages.png");

  // ── 04 — Reload at 1280×720 to get the attack-stage mid-run shot ─────────
  console.log("\n[04] Attack stage (1280×720, 3s into replay)...");
  const pg2 = await browser.newPage();
  await pg2.setViewport({ width: 1280, height: 720 });
  await pg2.goto(DEMO_RUN, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000)); // mid-replay: attack done, prove in-progress
  await save(pg2, "04-attack-akashml-llama.png");
  await pg2.close();

  // ── 05 — All 13 stages complete (1280×720) ────────────────────────────────
  console.log("\n[05] All 13 stages complete (1280×720)...");
  const pg3 = await browser.newPage();
  await pg3.setViewport({ width: 1280, height: 720 });
  await pg3.goto(DEMO_RUN, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000)); // full replay done
  await save(pg3, "05-all-stages-running.png");
  await pg3.close();

  // ── Back to the 1440×900 page for sectional shots ────────────────────────
  // Scroll down to see Fix Analysis + Proof sections
  console.log("\n[06] ClickHouse detection — clip from overview...");
  // ClickHouse panel is top-right of content. In 1440×900:
  // approx: x=785, y=275, w=640, h=170
  await pg.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 300));
  await save(pg, "06-clickhouse-118ms-detect.png", {
    clip: { x: 785, y: 275, width: 640, height: 170 },
  });

  // ── 07 — Scroll into Fix Analysis + Proof section ─────────────────────────
  console.log("\n[07] Fix Analysis + Proof (scrolled into view)...");
  // The fix analysis section starts below findings (~680px in 1440×900)
  // Use scrollIntoView via JS
  await pg.evaluate(() => {
    const el = document.querySelector("h2, [class*='fix'], section")
      || Array.from(document.querySelectorAll("*"))
            .find(n => n.textContent.trim().startsWith("FIX ANALYSIS"));
    if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    else window.scrollTo(0, 700);
  });
  await new Promise(r => setTimeout(r, 400));
  await save(pg, "07-fix-blast-radius.png");

  // ── 08 — Proof section (POST-FIX VERIFICATION with 404 results) ──────────
  console.log("\n[08] Post-fix proof (404 verification)...");
  await pg.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const el = all.find(n => n.textContent.trim().startsWith("PROOF"));
    if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    else window.scrollTo(0, 1400);
  });
  await new Promise(r => setTimeout(r, 400));
  await save(pg, "08-run-complete-29s.png");

  await pg.close();
  await browser.close();

  console.log(`\nAll screenshots saved to: ${OUT}`);
  const files = fs.readdirSync(OUT).filter(f => /^\d\d-/.test(f)).sort();
  files.forEach(f => {
    const kb = Math.round(fs.statSync(path.join(OUT, f)).size / 1024);
    console.log(`  ${f} — ${kb}KB`);
  });
})();
