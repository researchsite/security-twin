#!/usr/bin/env bash
# demo.sh — start all services, optionally trigger a live run, open the dashboard
#
# Usage:
#   bash scripts/demo.sh            → demo mode  (bundled recording at /runs/demo-2024-idor)
#   bash scripts/demo.sh --live     → start a real pipeline run and open its page
#   bash scripts/demo.sh --stop     → stop all services
#   bash scripts/demo.sh --status   → print service health
#
# Prerequisites: run from the project root or from WSL with the project on /mnt/c

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEMO_RUN_ID="demo-2024-idor"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; }
info() { printf "${CYAN}→${NC} %s\n"  "$1"; }
err()  { printf "${RED}✗${NC} %s\n"   "$1" >&2; }

# ── Helpers ───────────────────────────────────────────────────────────────────

svc_ok() {
  local url="$1"
  curl -sf --max-time 2 "$url" > /dev/null 2>&1
}

wait_for() {
  local name="$1" url="$2" max="${3:-20}"
  printf "  waiting %-14s" "$name…"
  for i in $(seq 1 "$max"); do
    if svc_ok "$url"; then printf " ready\n"; return 0; fi
    sleep 1; printf "."
  done
  printf " timeout\n"; return 1
}

open_browser() {
  local url="$1"
  if command -v xdg-open &>/dev/null 2>&1; then
    xdg-open "$url" &>/dev/null &
  elif command -v wslview &>/dev/null 2>&1; then
    wslview "$url"
  elif command -v open &>/dev/null 2>&1; then
    open "$url"
  fi
}

# ── --stop ────────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--stop" ]]; then
  bash "$SCRIPT_DIR/stop-all.sh"
  exit 0
fi

# ── --status ──────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--status" ]]; then
  bash "$SCRIPT_DIR/status.sh"
  exit 0
fi

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║        Security Twin  Demo           ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Check / start services ────────────────────────────────────────────────────

NEED_START=0
svc_ok "http://localhost:3000/healthz" || NEED_START=1
svc_ok "http://localhost:8080/healthz" || NEED_START=1
svc_ok "http://localhost:4001/healthz" || NEED_START=1
svc_ok "http://localhost:3001"          || NEED_START=1

if [[ "$NEED_START" == "1" ]]; then
  info "Starting services…"
  echo ""
  bash "$SCRIPT_DIR/start-all.sh"
  echo ""
  wait_for "demo-app"     "http://localhost:3000/healthz" 30
  wait_for "shield"       "http://localhost:8080/healthz" 30
  wait_for "orchestrator" "http://localhost:4001/healthz" 30
  wait_for "dashboard"    "http://localhost:3001"          60
  echo ""
else
  ok "all services already running"
  echo ""
fi

# ── Live run ──────────────────────────────────────────────────────────────────

if [[ "${1:-}" == "--live" ]]; then
  info "Starting live pipeline run…"
  RESP=$(curl -sf -X POST http://localhost:4001/run/start \
    -H "Content-Type: application/json" \
    -d '{}' 2>&1) || { err "orchestrator not responding"; exit 1; }

  RUN_ID=$(echo "$RESP" | grep -o '"run_id":"[^"]*"' | cut -d'"' -f4)
  ok "Run started: $RUN_ID"
  echo ""
  echo "  Dashboard : http://localhost:3001/runs/$RUN_ID"
  echo "  SSE stream: http://localhost:4001/api/runs/$RUN_ID/stream"
  echo ""
  open_browser "http://localhost:3001/runs/$RUN_ID"
  echo "  (streaming… press Ctrl-C to detach)"
  echo ""
  # Tail the SSE for 60 seconds to show progress
  timeout 60 curl -sN "http://localhost:4001/api/runs/$RUN_ID/stream" \
    | grep --line-buffered '"type"' \
    | awk -F'"' '
        /stage_start/ { printf "  [%s] starting…\n",  $8 }
        /stage_done/  { printf "  [%s] done\n",       $8 }
        /stage_error/ { printf "  [%s] ERROR\n",      $8 }
        /run_done/    { print  "  pipeline complete ✓"; exit }
      ' || true
else
  echo "  Demo run  : http://localhost:3001/runs/$DEMO_RUN_ID"
  echo "  Dashboard : http://localhost:3001"
  echo "  Memory    : http://localhost:3001/memory"
  echo ""
  echo "  To start a live run : bash scripts/demo.sh --live"
  echo "  To stop services    : bash scripts/demo.sh --stop"
  echo ""
  open_browser "http://localhost:3001/runs/$DEMO_RUN_ID"
fi
