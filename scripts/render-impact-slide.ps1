Add-Type -AssemblyName System.Drawing

$W = 1920; $H = 1080
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

# Palette
$bg     = [System.Drawing.Color]::FromArgb( 10,  14,  20)
$card   = [System.Drawing.Color]::FromArgb( 15,  24,  34)
$card2  = [System.Drawing.Color]::FromArgb( 18,  30,  44)
$green  = [System.Drawing.Color]::FromArgb( 61, 220, 151)
$amber  = [System.Drawing.Color]::FromArgb(255, 170,  50)
$red    = [System.Drawing.Color]::FromArgb(255,  80,  80)
$blue   = [System.Drawing.Color]::FromArgb( 80, 160, 255)
$txt    = [System.Drawing.Color]::FromArgb(234, 240, 246)
$sub    = [System.Drawing.Color]::FromArgb(143, 163, 188)
$dim    = [System.Drawing.Color]::FromArgb( 55,  75,  95)
$border = [System.Drawing.Color]::FromArgb( 25,  40,  58)

function Br($c) { New-Object System.Drawing.SolidBrush($c) }
function Pn($c, [float]$w=1) { New-Object System.Drawing.Pen($c, $w) }

# Background + grid
$g.Clear($bg)
$gp = Pn ([System.Drawing.Color]::FromArgb(16, 255, 255, 255)) 1
for ($x = 0; $x -lt $W; $x += 60) { $g.DrawLine($gp, $x, 0, $x, $H) }
for ($y = 0; $y -lt $H; $y += 60) { $g.DrawLine($gp, 0, $y, $W, $y) }
$gp.Dispose()
$g.FillRectangle((Br $green), 0, 0, 5, $H)

# Fonts
$fHdr   = New-Object System.Drawing.Font("Arial", 36, [System.Drawing.FontStyle]::Bold)
$fSub   = New-Object System.Drawing.Font("Arial", 14)
$fLbl   = New-Object System.Drawing.Font("Arial",  9, [System.Drawing.FontStyle]::Bold)
$fBig   = New-Object System.Drawing.Font("Arial", 46, [System.Drawing.FontStyle]::Bold)
$fBigSm = New-Object System.Drawing.Font("Arial", 22, [System.Drawing.FontStyle]::Bold)
$fSpon  = New-Object System.Drawing.Font("Arial", 28, [System.Drawing.FontStyle]::Bold)
$fMono  = New-Object System.Drawing.Font("Courier New", 11)
$fBody  = New-Object System.Drawing.Font("Arial", 13)
$fBodyB = New-Object System.Drawing.Font("Arial", 13, [System.Drawing.FontStyle]::Bold)
$fFoot  = New-Object System.Drawing.Font("Arial", 11)
$fProof = New-Object System.Drawing.Font("Courier New", 10)

#  HEADER (y 0-105) 
$g.FillRectangle((Br $card), 0, 0, $W, 105)
$g.DrawLine((Pn $green 2), 5, 105, $W, 105)
$g.DrawString("Security Twin", $fHdr, (Br $txt), 28, 20)
$g.DrawString("13-stage autonomous AI red-team   |   real impact with sponsor tools", $fSub, (Br $sub), 30, 68)
$g.DrawString("dashboard-sigma-sable-28.vercel.app", $fSub, (Br $green), 1430, 68)

#  METRIC CARDS (y 114-244, h 130) 
$mY = 114; $mH = 130; $mGap = 18
$mW = [int](($W - 30 - 30 - 3*$mGap) / 4)
$metrics = @(
    @{ big="29s";       unit="end-to-end";           cap="TOTAL RUN TIME";    col=$green },
    @{ big="13";        unit="stages, 0 skipped";    cap="PIPELINE STAGES";   col=$blue  },
    @{ big="23ms";      unit="12,450 rows scanned";  cap="CLICKHOUSE DETECT"; col=$amber },
    @{ big="1  ->  0";  unit="CWE-639 IDOR fixed";   cap="SEMGREP SCORE";     col=$red   }
)
for ($i = 0; $i -lt $metrics.Count; $i++) {
    $mx = 30 + $i * ($mW + $mGap)
    $m  = $metrics[$i]
    $g.FillRectangle((Br $card), $mx, $mY, $mW, $mH)
    $g.DrawRectangle((Pn $border 1), $mx, $mY, $mW, $mH)
    $g.FillRectangle((Br $m.col), $mx, $mY, 4, $mH)
    $bf  = if ($m.big -like "*->*") { $fBigSm } else { $fBig }
    $bfy = if ($m.big -like "*->*") { $mY+38 } else { $mY+20 }
    $g.DrawString($m.big,  $bf,   (Br $m.col), ($mx+16), $bfy)
    $g.DrawString($m.unit, $fBody,(Br $sub),   ($mx+16), ($mY+$mH-28))
    $g.DrawString($m.cap,  $fLbl, (Br $dim),   ($mx+16), ($mY+8))
}

#  SPONSOR CARDS (y 258-678, h 420) 
$sY = 258; $sH = 420; $sGap = 22
$sW = [int](($W - 30 - 30 - 2*$sGap) / 3)

$sponsors = @(
    @{
        name  = "AkashML"
        tag   = "STAGE 3 - LLM ATTACK"
        col   = $green
        model = "meta-llama/Llama-3.3-70B-Instruct"
        stats = @("2,106ms  attack stage", "IDOR exploit confirmed", "alice reads bob's kit-3 + kit-5", "function-call tool use verified")
        how1  = "Attacker agent uses AkashML's OpenAI-compatible API."
        how2  = "Set LLM_PROVIDER=akash - same agent code, zero rewrites."
        how3  = "Llama 3.3 70B fires IDOR payloads through the shield proxy."
        proof = "GET /api/kits/kit-3 as alice  ->  200  (IDOR confirmed)"
        pcol  = $red
    },
    @{
        name  = "ClickHouse"
        tag   = "STAGE 5 - DETECT"
        col   = $amber
        model = "AggregatingMergeTree materialized view"
        stats = @("12,450 rows scanned", "23ms  single SQL query", "6 distinct kit IDs flagged", "72 cross-user hits / 1 min")
        how1  = "Single SQL on a pre-aggregated MV detects IDOR enumeration."
        how2  = "No in-app counters, no Redis - just SQL on real HTTP logs."
        how3  = "Shield batches 10K rows / 500ms into ClickHouse Cloud."
        proof = "SELECT ip, count() FROM requests_kit_enum  ->  23ms"
        pcol  = $amber
    },
    @{
        name  = "Semgrep"
        tag   = "STAGES 2, 7, 11  -  SCAN / CONFIRM / CI GATE"
        col   = $blue
        model = "SEC-001 memory rule  -  auto-generated"
        stats = @("score_before = 1   score_after = 0", "Semgrep rule committed to fork PR", "twin-gate.yml CI gate added", "demo/idor-regression branch blocked")
        how1  = "Semgrep scans the clone and confirms the root cause in code."
        how2  = "Auto-generated SEC-001.yaml rule committed as blocking CI check."
        how3  = "Every future PR that repeats the pattern is rejected."
        proof = "Semgrep --config rules/memory/  ->  FAIL  (PR blocked)"
        pcol  = $blue
    }
)

for ($i = 0; $i -lt $sponsors.Count; $i++) {
    $sx = 30 + $i * ($sW + $sGap)
    $s  = $sponsors[$i]
    $g.FillRectangle((Br $card), $sx, $sY, $sW, $sH)
    $g.DrawRectangle((Pn $border 1), $sx, $sY, $sW, $sH)
    $g.FillRectangle((Br $s.col), $sx, $sY, $sW, 4)

    # tag
    $g.DrawString($s.tag,   $fLbl,  (Br $s.col), ($sx+14), ($sY+12))
    # name
    $g.DrawString($s.name,  $fSpon, (Br $txt),   ($sx+14), ($sY+28))
    # model
    $g.DrawString($s.model, $fMono, (Br $sub),   ($sx+14), ($sY+72))
    # divider
    $g.DrawLine((Pn $border 1), ($sx+14), ($sY+98), ($sx+$sW-14), ($sY+98))

    # stats (4 lines)
    $sy2 = $sY + 108
    foreach ($stat in $s.stats) {
        $g.FillRectangle((Br ([System.Drawing.Color]::FromArgb(30, 61, 220, 151))), ($sx+14), $sy2, 6, 18)
        $g.DrawString($stat, $fBody, (Br $txt), ($sx+26), $sy2)
        $sy2 += 26
    }

    # HOW IT'S USED
    $g.DrawLine((Pn $border 1), ($sx+14), ($sY+218), ($sx+$sW-14), ($sY+218))
    $g.DrawString("HOW IT'S USED", $fLbl, (Br $dim), ($sx+14), ($sY+226))
    $g.DrawString($s.how1, $fBody, (Br $sub), ($sx+14), ($sY+244))
    $g.DrawString($s.how2, $fBody, (Br $sub), ($sx+14), ($sY+266))
    $g.DrawString($s.how3, $fBody, (Br $sub), ($sx+14), ($sY+288))

    # proof bar at bottom
    $g.FillRectangle((Br ([System.Drawing.Color]::FromArgb(255, 8, 18, 28))), ($sx+14), ($sY+$sH-44), ($sW-28), 30)
    $g.DrawString($s.proof, $fProof, (Br $s.pcol), ($sx+18), ($sY+$sH-38))
}

#  LEARNINGS (y 692-1022, h 330) 
$lY = $sY + $sH + 14
$lH = 330
$g.FillRectangle((Br $card2), 30, $lY, ($W-60), $lH)
$g.DrawRectangle((Pn $border 1), 30, $lY, ($W-60), $lH)
$g.FillRectangle((Br $green), 30, $lY, 4, $lH)
$g.DrawString("WHAT I LEARNED", $fLbl, (Br $green), 46, ($lY+14))

# Left column
$lx1 = 46; $lx2 = [int]($W/2) + 30
$col1 = @(
    @{ head="SSE flush requires Node.js http.request"; body="fetch() and ReadableStream both buffer  -  only the legacy Node.js http.request API flushes SSE reliably in Next.js App Router." },
    @{ head="Next.js hot-reload silently re-reads .env.local"; body="Shell exports are overridden at reload time. Set env vars inside .env.local, not the shell, or they vanish mid-demo." },
    @{ head="AkashML = zero-rewrite provider switch"; body="OpenAI-compatible API: same agent code, same tool schema. Just LLM_PROVIDER=akash + AKASHML_API_KEY and Llama runs." }
)
$col2 = @(
    @{ head="Windows home routers drop MongoDB SRV DNS"; body="Atlas SRV (_mongodb._tcp.*) resolution fails on many home routers. Fix: dns.setServers(['8.8.8.8']) before connect()." },
    @{ head="ClickHouse cold-start = silent in-memory fallback"; body="First flush after a new connection silently drops rows. Warm the connection with a test query before the demo traffic stage." },
    @{ head="x-run-id header needs middleware tagging"; body="If shield middleware only reads query params, the x-run-id header never propagates. Tag it explicitly in the session middleware." }
)

function DrawLearn($g, $items, $x, $startY, $maxW, $fHead, $fBody, $txt, $sub, $dim) {
    $y = $startY
    foreach ($item in $items) {
        $g.DrawString($item.head, $fHead, (New-Object System.Drawing.SolidBrush($txt)), $x, $y)
        $y += 22
        # wrap body text
        $words = $item.body -split ' '
        $line = ""; $ly = $y
        foreach ($word in $words) {
            $test = if ($line) { "$line $word" } else { $word }
            $sz = $g.MeasureString($test, $fBody)
            if ($sz.Width -gt $maxW) {
                $g.DrawString($line, $fBody, (New-Object System.Drawing.SolidBrush($sub)), $x, $ly)
                $line = $word; $ly += 19
            } else { $line = $test }
        }
        if ($line) { $g.DrawString($line, $fBody, (New-Object System.Drawing.SolidBrush($sub)), $x, $ly); $ly += 19 }
        $y = $ly + 22
    }
}

DrawLearn $g $col1 $lx1 ($lY+36) 850 $fBodyB $fBody $txt $sub $dim
DrawLearn $g $col2 $lx2 ($lY+36) 850 $fBodyB $fBody $txt $sub $dim

#  FOOTER 
$g.DrawLine((Pn $border 1), 30, ($H-34), ($W-30), ($H-34))
$g.DrawString("Security Twin   |   13 stages, 29 seconds, zero configuration drift   |   AkashML + ClickHouse + Semgrep   |   dashboard-sigma-sable-28.vercel.app", $fFoot, (Br $dim), 30, ($H-26))

# Save
$out = "C:\AI\AGentic\security-twin\docs\screenshots\impact-slide.png"
$bmp.Save($out)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $out"
