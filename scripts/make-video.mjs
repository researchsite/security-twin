/**
 * make-video.mjs
 *
 * Generates a <2-minute demo video for Security Twin:
 *   1. Calls ElevenLabs TTS to produce narration audio
 *   2. Creates a slide-deck HTML file with auto-timed transitions
 *   3. Uses Puppeteer to render each slide as a PNG frame sequence
 *   4. Assembles frames + audio into _private/demo.mp4 via ffmpeg
 *
 * Requirements:
 *   npm install puppeteer  (in scripts/node_modules, or globally)
 *   ffmpeg on PATH
 *   ELEVENLABS_API_KEY in .env.local
 *
 * Usage:
 *   node scripts/make-video.mjs
 *   node scripts/make-video.mjs --no-tts     # skip TTS, use existing audio/narration.mp3
 *   node scripts/make-video.mjs --no-ffmpeg  # generate frames only
 */

import { loadEnv } from "./_env.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync, spawnSync } from "child_process";

loadEnv();

const __dir  = path.dirname(fileURLToPath(import.meta.url));
const ROOT   = path.resolve(__dir, "..");
const PRIV   = path.join(ROOT, "_private");
const SHOTS  = path.join(ROOT, "docs", "screenshots");
const OUT    = path.join(PRIV, "video");
const FRAMES = path.join(OUT, "frames");
const AUDIO  = path.join(OUT, "narration.mp3");
const VIDEO  = path.join(PRIV, "demo.mp4");

const SKIP_TTS    = process.argv.includes("--no-tts");
const SKIP_FFMPEG = process.argv.includes("--no-ffmpeg");

// Font path for ffmpeg drawtext on Windows (colon must be escaped as \:)
const FONT = process.platform === "win32"
  ? "C\\\\:/Windows/Fonts/arial.ttf"
  : "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";

// ─── Narration script ────────────────────────────────────────────────────────
// 10 segments, each backed by a real app screenshot. ~90s total.
const SEGMENTS = [
  {
    id: "target",
    duration: 7,
    label: "THE TARGET APP",
    text: "This is Kit Store — a Node.js API with a planted IDOR bug. GET /api/kits/:id has no ownership check. Any logged-in user can read any other user's data. This is exactly the bug AI coding assistants ship.",
  },
  {
    id: "dashboard",
    duration: 8,
    label: "SECURITY TWIN DASHBOARD",
    text: "Security Twin dashboard. One click starts a full 13-stage autonomous pipeline. Clone, attack, detect, fix, prove, and lock — all streamed live.",
  },
  {
    id: "pipeline-start",
    duration: 8,
    label: "PIPELINE STARTS",
    text: "The pipeline begins. All 13 stages are queued: clone, scan, attack, traffic, detect, map, confirm, remember, fix, prove, sync, alert, brief. Every event streams in real time over Server-Sent Events.",
  },
  {
    id: "attack",
    duration: 9,
    label: "STAGE 3 — LLM ATTACK (AKASHML)",
    text: "Stage 3: AkashML Llama 3.3 70B fires IDOR payloads through the shield proxy. Alice reads kit-3, owned by Bob. Kit-5, owned by Carol. The breach is live and being logged.",
  },
  {
    id: "all-stages",
    duration: 9,
    label: "ALL 13 STAGES RUNNING",
    text: "All 13 stages streaming. Traffic stage floods ClickHouse at 640 requests per second. 16,000 requests in 25 seconds. The AggregatingMergeTree materialized view is pre-aggregating in real time.",
  },
  {
    id: "clickhouse",
    duration: 10,
    label: "STAGE 5 — CLICKHOUSE: 118ms DETECT",
    text: "Stage 5: one SQL HAVING query across 6,802 real events. 118 milliseconds. Five attacking IPs caught. Top IP: 12 distinct kit IDs enumerated in one minute. No counters, no Redis — just SQL.",
  },
  {
    id: "fix",
    duration: 8,
    label: "STAGE 9 — BLAST-RADIUS FIX",
    text: "Stage 9: blast-radius scan finds one caller. Non-breaking ownership guard applied. Semgrep score: 1 before, 0 after. Original source tree untouched — fix is in the isolated work copy only.",
  },
  {
    id: "complete",
    duration: 9,
    label: "ALL 13 STAGES COMPLETE — 29 SECONDS",
    text: "All 13 stages complete. 29 seconds. The IDOR is found, patched, and proved fixed. A Semgrep rule is committed to CI. The same bug cannot enter through a future pull request.",
  },
  {
    id: "final",
    duration: 8,
    label: "COMPLETE RUN WITH DATA",
    text: "Full run results: findings, ClickHouse detection data, attacker confession, fix diff, and proof. All stored in MongoDB. Replay any run from the dashboard.",
  },
  {
    id: "outro",
    duration: 7,
    label: "SECURITY TWIN",
    text: "Security Twin. Live demo: dashboard-sigma-sable-28.vercel.app. GitHub: researchsite/security-twin. ClickHouse, Semgrep, AkashML, MongoDB, Next.js.",
  },
];

const TOTAL_SECONDS = SEGMENTS.reduce((s, x) => s + x.duration, 0);

// ─── Slide HTML for each segment ─────────────────────────────────────────────
function slideHtml(seg, screenshotSrc) {
  const hasImage = screenshotSrc && fs.existsSync(screenshotSrc);
  const imgTag   = hasImage
    ? `<img src="${screenshotSrc}" style="max-width:100%;max-height:340px;border-radius:8px;border:1px solid #1A2638;object-fit:contain;" />`
    : "";

  const labels = {
    hook:       "The Problem",
    what:       "The Solution",
    dashboard:  "Live Dashboard",
    attack:     "Stage 3 — LLM Attack",
    clickhouse: "Stage 5 — ClickHouse Detect",
    fix:        "Stage 9 — Blast-Radius Fix",
    ci:         "CI Gate — Twin Gate",
    complete:   "All 13 Stages Complete",
    outro:      "Security Twin",
  };

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px; height: 720px; overflow: hidden;
    background: #0C1017; color: #EAF0F6;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    display: flex; flex-direction: column;
    padding: 48px 72px 40px;
  }
  .label {
    font-size: 11px; font-weight: 700; letter-spacing: 0.16em;
    text-transform: uppercase; color: #3DDC97; margin-bottom: 10px;
  }
  .title { font-size: 42px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
  .accent { color: #3DDC97; }
  .rule { width: 40px; height: 3px; background: #3DDC97; border-radius: 2px; margin: 14px 0 18px; }
  .body {
    font-size: 19px; color: #8FA3BC; line-height: 1.65; max-width: 720px;
    ${hasImage ? "margin-bottom: 24px;" : "flex: 1; display: flex; align-items: center;"}
  }
  .img-wrap { flex: 1; display: flex; align-items: center; }
  .stat-row { display: flex; gap: 32px; margin-top: 24px; }
  .stat { background: #0F1822; border-left: 3px solid #3DDC97; border-radius: 0 6px 6px 0; padding: 12px 20px; }
  .stat-num { font-size: 28px; font-weight: 700; color: #3DDC97; }
  .stat-lbl { font-size: 11px; color: #4A6278; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px; }
  .watermark { position: absolute; bottom: 22px; right: 52px; font-size: 11px; color: #1D2E42; letter-spacing: 0.06em; }
</style>
</head>
<body>
  <div class="label">${labels[seg.id] ?? seg.id}</div>
  <h1 class="title"><span class="accent">Security</span> Twin</h1>
  <div class="rule"></div>
  <div class="body">${seg.text}</div>
  ${hasImage ? `<div class="img-wrap">${imgTag}</div>` : ""}
  ${seg.id === "clickhouse" ? `
  <div class="stat-row">
    <div class="stat"><div class="stat-num">118ms</div><div class="stat-lbl">Detect query</div></div>
    <div class="stat"><div class="stat-num">6,802</div><div class="stat-lbl">Events scanned</div></div>
    <div class="stat"><div class="stat-num">5</div><div class="stat-lbl">IPs flagged</div></div>
    <div class="stat"><div class="stat-num">29s</div><div class="stat-lbl">Full pipeline</div></div>
  </div>` : ""}
  ${seg.id === "outro" ? `
  <div class="stat-row" style="margin-top:28px">
    <div class="stat"><div class="stat-num" style="font-size:14px">dashboard-sigma-sable-28.vercel.app</div><div class="stat-lbl">Live demo</div></div>
    <div class="stat"><div class="stat-num" style="font-size:14px">github.com/researchsite/security-twin</div><div class="stat-lbl">GitHub</div></div>
  </div>` : ""}
  <div class="watermark">Security Twin · 2026</div>
</body>
</html>`;
}

// Every segment gets a real app screenshot — no blank/text-only slides
const SCREENSHOT_MAP = {
  target:           path.join(SHOTS, "01-target-app-idor-bug.png"),
  dashboard:        path.join(SHOTS, "02-dashboard-home.png"),
  "pipeline-start": path.join(SHOTS, "03-pipeline-all-13-stages.png"),
  attack:           path.join(SHOTS, "04-attack-akashml-llama.png"),
  "all-stages":     path.join(SHOTS, "05-all-stages-running.png"),
  clickhouse:       path.join(SHOTS, "06-clickhouse-118ms-detect.png"),
  fix:              path.join(SHOTS, "07-fix-blast-radius.png"),
  complete:         path.join(SHOTS, "08-run-complete-29s.png"),
  final:            path.join(SHOTS, "08-run-complete-29s.png"),
  outro:            path.join(SHOTS, "impact-slide.png"),
};

// ─── Step 1: TTS (OpenAI primary, ElevenLabs fallback) ───────────────────────
async function generateTTS() {
  const fullScript = SEGMENTS.map(s => s.text).join(" ... ");
  const words = fullScript.split(" ").length;
  console.log(`\n[TTS] Generating narration (${words} words, ~${TOTAL_SECONDS}s) …`);

  // Try OpenAI TTS first (they have this key)
  const openaiKey = process.env.OPENAI_API_KEY ?? process.env.ATTACKER_API_KEY;
  if (openaiKey) {
    const ok = await ttsOpenAI(openaiKey, fullScript);
    if (ok) return true;
  }

  // Fallback: ElevenLabs
  const elKey = process.env.ELEVENLABS_API_KEY;
  if (elKey) {
    const ok = await ttsElevenLabs(elKey, fullScript);
    if (ok) return true;
  }

  // Final fallback: Windows built-in TTS via PowerShell (no API key needed)
  if (process.platform === "win32") {
    const ok = await ttsWindows(fullScript);
    if (ok) return true;
  }

  console.error("✗  No TTS available. Place narration.mp3 manually at:", AUDIO);
  return false;
}

async function ttsWindows(text) {
  console.log("[TTS] Using Windows Speech Synthesis (no API key needed) …");
  const wavFile = AUDIO.replace(/\.mp3$/, ".wav");

  // Escape single quotes in text for PowerShell
  const safe = text.replace(/'/g, "''");

  const ps = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 1
$synth.Volume = 100
$voices = $synth.GetInstalledVoices() | Select-Object -ExpandProperty VoiceInfo | Where-Object { $_.Gender -eq 'Female' }
if ($voices.Count -gt 0) { $synth.SelectVoice($voices[0].Name) }
$synth.SetOutputToWaveFile('${wavFile.replace(/\\/g, "\\\\")}')
$synth.Speak('${safe}')
$synth.Dispose()
Write-Output "done"
`.trim();

  const psFile = path.join(OUT, "tts.ps1");
  fs.writeFileSync(psFile, ps, "utf8");

  const result = spawnSync("powershell", ["-NonInteractive", "-File", psFile], { stdio: "pipe" });
  if (result.status !== 0) {
    console.warn("  Windows TTS error:", result.stderr?.toString().slice(0, 200));
    return false;
  }

  if (!fs.existsSync(wavFile)) {
    console.warn("  Windows TTS: wav file not created");
    return false;
  }

  // Convert WAV → MP3 using ffmpeg if available, otherwise keep WAV and update AUDIO path
  const ffmpegCheck = spawnSync("ffmpeg", ["-version"], { stdio: "pipe" });
  if (ffmpegCheck.status === 0) {
    execSync(`ffmpeg -y -i "${wavFile}" -codec:a libmp3lame -q:a 4 "${AUDIO}"`, { stdio: "pipe" });
    fs.unlinkSync(wavFile);
    console.log(`✓  Audio (Windows TTS) → ${AUDIO}`);
  } else {
    // No ffmpeg: use WAV directly and patch AUDIO variable for assembly step
    Object.defineProperty(global, "__AUDIO_FILE", { value: wavFile, configurable: true });
    console.log(`✓  Audio (Windows TTS, WAV) → ${wavFile}`);
    console.log("   Note: install ffmpeg to convert to MP3 and assemble video");
  }
  return true;
}

async function ttsOpenAI(key, text) {
  try {
    console.log("[TTS] Using OpenAI TTS (nova voice) …");
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "tts-1-hd", input: text, voice: "nova", speed: 1.0 }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn("  OpenAI TTS error:", res.status, err.slice(0, 120));
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(AUDIO, buf);
    console.log(`✓  Audio saved → ${AUDIO} (${(buf.length / 1024).toFixed(0)} KB)`);
    return true;
  } catch (e) {
    console.warn("  OpenAI TTS exception:", e.message);
    return false;
  }
}

async function ttsElevenLabs(key, text) {
  try {
    console.log("[TTS] Using ElevenLabs (Rachel voice) …");
    const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2",
        voice_settings: { stability: 0.45, similarity_boost: 0.82, style: 0.18 },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn("  ElevenLabs error:", res.status, err.slice(0, 120));
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(AUDIO, buf);
    console.log(`✓  Audio saved → ${AUDIO} (${(buf.length / 1024).toFixed(0)} KB)`);
    return true;
  } catch (e) {
    console.warn("  ElevenLabs exception:", e.message);
    return false;
  }
}

// ─── Step 2: Render slides via PowerShell GDI+ → PNG → ffmpeg clips ──────────
// PowerShell's System.Drawing (GDI+) is always available on Windows 11.
// Each segment: generate a 1280x720 PNG, loop it into a short .mp4 clip.
async function renderFrames() {
  const ffmpegCheck = spawnSync("ffmpeg", ["-version"], { stdio: "pipe" });
  if (ffmpegCheck.status !== 0) {
    console.error("✗  ffmpeg not found. Cannot render clips.");
    return false;
  }

  fs.mkdirSync(FRAMES, { recursive: true });
  const clipFiles = [];

  for (const seg of SEGMENTS) {
    console.log(`[RENDER] ${seg.id}  (${seg.duration}s)`);
    const pngPath  = path.join(FRAMES, `slide-${seg.id}.png`);
    const clipPath = path.join(FRAMES, `clip-${seg.id}.mp4`);
    clipFiles.push(clipPath);

    // Generate slide PNG via PowerShell GDI+
    const ok = renderSlide(seg, pngPath);
    if (!ok) {
      console.warn(`  GDI+ render failed for ${seg.id}, using black frame`);
    }

    // Loop the PNG into a clip
    const src = ok ? pngPath : null;
    if (src && fs.existsSync(src)) {
      const r = spawnSync("ffmpeg", [
        "-y", "-loop", "1", "-t", String(seg.duration), "-i", src,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
        "-pix_fmt", "yuv420p", "-r", "24", "-an",
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0C1017",
        clipPath,
      ], { stdio: "pipe" });
      if (r.status !== 0) {
        console.warn(`  ffmpeg loop failed: ${r.stderr?.toString().slice(0, 120)}`);
        spawnSync("ffmpeg", [
          "-y", "-f", "lavfi", "-t", String(seg.duration),
          "-i", "color=c=0x0C1017:s=1280x720:r=24",
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
          "-pix_fmt", "yuv420p", "-r", "24", "-an", clipPath,
        ], { stdio: "pipe" });
      }
    } else {
      spawnSync("ffmpeg", [
        "-y", "-f", "lavfi", "-t", String(seg.duration),
        "-i", "color=c=0x0C1017:s=1280x720:r=24",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
        "-pix_fmt", "yuv420p", "-r", "24", "-an", clipPath,
      ], { stdio: "pipe" });
    }

    console.log(`  ✓ ${path.basename(clipPath)}`);
  }

  // Write concat list (forward slashes to avoid Windows path issues in ffmpeg)
  const concatList = path.join(FRAMES, "concat.txt");
  fs.writeFileSync(concatList,
    clipFiles.map(f => `file '${f.replace(/\\/g, "/")}'`).join("\n")
  );
  console.log(`✓  ${clipFiles.length} clips → ${FRAMES}`);
  global.__CLIP_LIST = concatList;
  return true;
}

// Render one slide as a PNG using PowerShell System.Drawing (GDI+).
function renderSlide(seg, outPng) {
  // Sanitize text for PowerShell double-quoted strings: strip/replace non-ASCII
  const psText = (s) => s
    .replace(/—/g, " - ")   // em dash
    .replace(/–/g, " - ")   // en dash
    .replace(/‘|’/g, "'")  // smart single quotes
    .replace(/“|”/g, '"')  // smart double quotes (replaced later)
    .replace(/[^\x00-\x7F]/g, "")   // drop remaining non-ASCII
    .replace(/"/g, '`"');            // escape remaining " for PS

  // Use label from segment definition, fall back to id
  const labelText = seg.label ?? seg.id.toUpperCase();

  const shot = SCREENSHOT_MAP[seg.id];
  const hasShot = shot && fs.existsSync(shot);
  const label = labelText;
  const lines = wrapText(seg.text, 66, 5);
  const linesPs = lines.map(l => `"${psText(l)}"`).join(", ");

  const DARK_BG   = "System.Drawing.Color]::FromArgb(12, 16, 23)";
  const CARD_BG   = "System.Drawing.Color]::FromArgb(15, 24, 34)";
  const GREEN     = "System.Drawing.Color]::FromArgb(61, 220, 151)";
  const TEXT      = "System.Drawing.Color]::FromArgb(234, 240, 246)";
  const SUBTEXT   = "System.Drawing.Color]::FromArgb(143, 163, 188)";
  const DIM       = "System.Drawing.Color]::FromArgb(74, 98, 120)";

  // PowerShell helper to avoid repeating [System.Drawing...
  let ps = `
Add-Type -AssemblyName System.Drawing
$W = 1280; $H = 720
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

$darkBg   = [${DARK_BG}
$cardBg   = [${CARD_BG}
$green    = [${GREEN}
$txtColor = [${TEXT}
$subColor = [${SUBTEXT}
$dimColor = [${DIM}

`;

  if (hasShot) {
    // Screenshot background, then overlays
    ps += `
$img = [System.Drawing.Image]::FromFile("${shot.replace(/\\/g,"\\\\")}")
$g.DrawImage($img, 0, 0, $W, $H)
$img.Dispose()
# Dark overlays
# NO full-frame dim — keep screenshot fully visible
# Top label bar (semi-transparent)
$g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 12, 16, 23))), 0, 0, $W, 50)
# Left green accent stripe in label bar
$g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 61, 220, 151))), 0, 0, 4, 50)
$fLabel = New-Object System.Drawing.Font("Arial", 13, [System.Drawing.FontStyle]::Bold)
$g.DrawString("${psText(label)}", $fLabel, (New-Object System.Drawing.SolidBrush($green)), 16, 16)
# Bottom caption bar — 2 lines tall to show more text
$g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 12, 16, 23))), 0, $H-80, $W, 80)
$fCaption = New-Object System.Drawing.Font("Arial", 13)
$captionLines = @(${lines.slice(0, 2).map(l => `"${psText(l)}"`).join(", ")})
for ($ci = 0; $ci -lt $captionLines.Count; $ci++) {
  $g.DrawString($captionLines[$ci], $fCaption, (New-Object System.Drawing.SolidBrush($subColor)), 16, ($H - 74 + $ci * 32))
}
`;
  } else {
    // Text-only dark slide
    ps += `
$g.Clear($darkBg)
# Left green accent bar
$g.FillRectangle((New-Object System.Drawing.SolidBrush($green)), 0, 0, 4, $H)
# Label
$fLabel = New-Object System.Drawing.Font("Arial", 11, [System.Drawing.FontStyle]::Bold)
$g.DrawString("${label}", $fLabel, (New-Object System.Drawing.SolidBrush($green)), 36, 58)
# Title
$fTitle = New-Object System.Drawing.Font("Arial", 48, [System.Drawing.FontStyle]::Bold)
$g.DrawString("Security Twin", $fTitle, (New-Object System.Drawing.SolidBrush($txtColor)), 36, 86)
# Green rule
$g.FillRectangle((New-Object System.Drawing.SolidBrush($green)), 36, 166, 52, 4)
# Body lines
$fBody = New-Object System.Drawing.Font("Arial", 17)
$lineTexts = @(${linesPs})
for ($i = 0; $i -lt $lineTexts.Count; $i++) {
  $g.DrawString($lineTexts[$i], $fBody, (New-Object System.Drawing.SolidBrush($subColor)), 36, (198 + $i * 34))
}
`;

    if (seg.id === "clickhouse") {
      ps += `
# Stats cards
function DrawCard($gfx, $x, $y, $num, $lbl, $bg, $accent, $dim) {
  $gfx.FillRectangle((New-Object System.Drawing.SolidBrush($bg)), $x, $y, 200, 80)
  $fNum = New-Object System.Drawing.Font("Arial", 28, [System.Drawing.FontStyle]::Bold)
  $fLbl = New-Object System.Drawing.Font("Arial", 10, [System.Drawing.FontStyle]::Bold)
  $gfx.DrawString($num, $fNum, (New-Object System.Drawing.SolidBrush($accent)), ($x + 16), ($y + 10))
  $gfx.DrawString($lbl, $fLbl, (New-Object System.Drawing.SolidBrush($dim)), ($x + 16), ($y + 54))
}
DrawCard $g 36  440 "118ms"  "DETECT QUERY" $cardBg $green $dimColor
DrawCard $g 254 440 "6,802"  "EVENTS"       $cardBg $green $dimColor
DrawCard $g 472 440 "29s"    "PIPELINE"     $cardBg $green $dimColor
`;
    }

    if (seg.id === "outro") {
      ps += `
$fUrl = New-Object System.Drawing.Font("Arial", 15)
$fLbl = New-Object System.Drawing.Font("Arial", 10, [System.Drawing.FontStyle]::Bold)
$g.FillRectangle((New-Object System.Drawing.SolidBrush($cardBg)), 36, 450, 760, 44)
$g.DrawString("dashboard-sigma-sable-28.vercel.app", $fUrl, (New-Object System.Drawing.SolidBrush($green)), 54, 463)
$g.FillRectangle((New-Object System.Drawing.SolidBrush($cardBg)), 36, 510, 660, 44)
$g.DrawString("github.com/researchsite/security-twin", $fUrl, (New-Object System.Drawing.SolidBrush($subColor)), 54, 522)
`;
    }
  }

  ps += `
$bmp.Save("${outPng.replace(/\\/g, "\\\\")}");
$g.Dispose(); $bmp.Dispose()
Write-Output "ok"
`;

  const psFile = path.join(FRAMES, `render-${seg.id}.ps1`);
  // Write with UTF-8 BOM so PowerShell 5.1 reads it as UTF-8 (not CP1252)
  const BOM = "﻿";
  fs.writeFileSync(psFile, BOM + ps.trim(), "utf8");
  const r = spawnSync("powershell", ["-NonInteractive", "-File", psFile], { stdio: "pipe" });
  if (r.status !== 0) {
    const errMsg = r.stderr?.toString().slice(0, 200) ?? "";
    console.warn(`  PS error: ${errMsg.split("\n").find(l => l.includes("Error") || l.includes("Missing")) ?? errMsg.slice(0, 80)}`);
  }
  return r.status === 0 && fs.existsSync(outPng);
}

function wrapText(text, maxLen, maxLines) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxLen) {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1) { current = words.slice(words.indexOf(w)).join(" "); break; }
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

// ─── Step 3: ffmpeg assembly (concat clips + audio) ───────────────────────────
function assembleMp4() {
  const concatList = global.__CLIP_LIST;
  if (!concatList || !fs.existsSync(concatList)) {
    console.error("✗  No clip list found — renderFrames must run first.");
    return false;
  }

  console.log(`\n[FFMPEG] Assembling final video …`);

  // Step 3a: concat all video clips into a single silent video
  const silentVideo = path.join(OUT, "silent.mp4");
  let concatResult = spawnSync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", silentVideo,
  ], { stdio: "pipe" });

  if (concatResult.status !== 0) {
    concatResult = spawnSync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", concatList,
      "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", silentVideo,
    ], { stdio: "pipe" });
    if (concatResult.status !== 0) {
      console.error("✗  Concat failed:", concatResult.stderr?.toString().slice(0, 200));
      return false;
    }
  }

  // Step 3b: mix audio in
  if (fs.existsSync(AUDIO)) {
    const muxResult = spawnSync("ffmpeg", [
      "-y", "-i", silentVideo, "-i", AUDIO,
      "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart", VIDEO,
    ], { stdio: "pipe" });
    if (muxResult.status !== 0) {
      console.warn("  Audio mux error — saving silent video");
      fs.copyFileSync(silentVideo, VIDEO);
    }
  } else {
    fs.copyFileSync(silentVideo, VIDEO);
  }

  const size = (fs.statSync(VIDEO).size / (1024 * 1024)).toFixed(1);
  console.log(`✓  Video → ${VIDEO}  (${size} MB, ~${TOTAL_SECONDS}s)`);
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Security Twin — Demo Video Generator");
  console.log(`  Target: ${TOTAL_SECONDS}s  (${SEGMENTS.length} segments)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  fs.mkdirSync(OUT,    { recursive: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  // Write a static storyboard HTML for manual review
  const storyboard = SEGMENTS.map((s, i) => `
    <div style="margin-bottom:32px;padding:20px;background:#0F1822;border-radius:8px;border-left:3px solid #3DDC97">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#3DDC97;margin-bottom:8px">
        ${i + 1}. ${s.id}  ·  ${s.duration}s
      </div>
      <p style="color:#8FA3BC;line-height:1.6;font-size:14px">${s.text}</p>
      ${SCREENSHOT_MAP[s.id] ? `<div style="margin-top:12px;font-size:11px;color:#2E3E52">Screenshot: ${path.basename(SCREENSHOT_MAP[s.id])}</div>` : ""}
    </div>`).join("");

  fs.writeFileSync(path.join(OUT, "storyboard.html"), `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Video Storyboard</title>
<style>body{background:#0C1017;color:#EAF0F6;font-family:system-ui,sans-serif;padding:40px;max-width:800px;margin:auto}</style>
</head><body>
<h1 style="color:#3DDC97;margin-bottom:8px">Security Twin — Video Storyboard</h1>
<p style="color:#4A6278;margin-bottom:28px">Total: ${TOTAL_SECONDS}s · ${SEGMENTS.length} segments · 1280×720 · 30fps</p>
${storyboard}
</body></html>`);

  console.log(`✓  Storyboard → ${path.join(OUT, "storyboard.html")}`);
  console.log(`   Open in browser to review narration before rendering.\n`);

  let audioOk  = fs.existsSync(AUDIO); // already generated
  let framesOk = false;

  if (!SKIP_TTS && !audioOk) {
    audioOk = await generateTTS();
  } else if (audioOk) {
    console.log(`[TTS] Using existing audio: ${AUDIO}`);
  }

  if (!SKIP_FFMPEG) {
    framesOk = await renderFrames();
    if (framesOk) assembleMp4();
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Done.");
  console.log(`  Storyboard:  ${path.join(OUT, "storyboard.html")}`);
  if (audioOk)  console.log(`  Audio:       ${AUDIO}`);
  if (framesOk) console.log(`  Frames:      ${FRAMES}`);
  if (fs.existsSync(VIDEO)) console.log(`  Video:       ${VIDEO}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch(err => { console.error(err); process.exit(1); });
