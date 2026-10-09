#!/usr/bin/env bash
# start-all.sh — start demo-app, shield, orchestrator, dashboard
# Works in Git Bash (Windows) and WSL/Linux
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/scripts/.pids"
LOG_DIR="$ROOT/scripts/.logs"
mkdir -p "$PID_DIR" "$LOG_DIR"

# ── Env ───────────────────────────────────────────────────────────────────────
if [ ! -f "$ROOT/.env.local" ]; then
  echo "ERROR: $ROOT/.env.local not found" >&2
  exit 1
fi
set -a; source "$ROOT/.env.local"; set +a
export DOTENV_CONFIG_PATH="$ROOT/.env.local"

# ── Helpers ───────────────────────────────────────────────────────────────────

NODE="$(command -v node)"

is_running() {
  local pidfile="$PID_DIR/$1.pid"
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  [ -n "$pids" ] && sleep 1 || true
}

start_svc() {
  local name="$1" dir="$2" cmd="$3"
  local pidfile="$PID_DIR/$name.pid" logfile="$LOG_DIR/$name.log"

  if is_running "$name"; then
    echo "  [$name] already running (pid=$(cat "$pidfile"))"
    return 0
  fi

  : > "$logfile"   # truncate log
  printf "  Starting %-14s" "$name..."

  # eval lets bash process VAR=val assignments before the node command
  ( cd "$dir" && eval "$cmd" ) >> "$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidfile"
  echo "  pid=$pid"
}

wait_ready() {
  local name="$1" url="$2"
  local i=0
  local port_num="${url##*:}"; port_num="${port_num%%/*}"
  printf "  Waiting %-14s " "$name"
  while ! curl -sf --max-time 2 "$url" > /dev/null 2>&1; do
    i=$((i+1))
    if [ $i -ge 40 ]; then
      echo "TIMEOUT — check scripts/.logs/$name.log"
      tail -5 "$LOG_DIR/$name.log"
      return 1
    fi
    # Detect crash: fatal error in log AND nothing listening on the port
    if [ $i -ge 5 ] && \
       grep -qE "(EADDRINUSE|Cannot find module|SyntaxError: |MODULE_NOT_FOUND)" \
                "$LOG_DIR/$name.log" 2>/dev/null && \
       ! lsof -ti tcp:"$port_num" > /dev/null 2>&1; then
      echo "CRASHED — tail of scripts/.logs/$name.log:"
      tail -5 "$LOG_DIR/$name.log"
      return 1
    fi
    printf "."
    sleep 1
  done
  echo " ready"
}

# ── Kill anything on our ports ────────────────────────────────────────────────
echo ""
echo "==> Clearing ports 3000 3001 4001 8080..."
for p in 3000 3001 4001 8080; do kill_port "$p"; done

# ── Install dependencies (quiet, parallel) ────────────────────────────────────
echo ""
echo "==> Installing dependencies..."
for pkg in demo-app shield orchestrator dashboard; do
  (cd "$ROOT/$pkg" && npm install --silent 2>/dev/null) &
done
wait
echo "    done"

# ── Services ──────────────────────────────────────────────────────────────────
RUN_ID="dev-$(date +%s)"
echo ""
echo "==> Starting services  (RUN_ID=$RUN_ID)"

# Use local ts-node/next binaries — avoids npx PATH issues in subshells
TSNODE="$NODE node_modules/ts-node/dist/bin.js"
NEXT_BIN="$NODE node_modules/next/dist/bin/next"

start_svc "demo-app" "$ROOT/demo-app" \
  "PORT=3000 $TSNODE src/index.ts"
wait_ready "demo-app" "http://localhost:3000/healthz"

start_svc "shield" "$ROOT/shield" \
  "SHIELD_PORT=8080 TWIN_URL=http://localhost:3000 RUN_ID=$RUN_ID $TSNODE src/index.ts"
wait_ready "shield" "http://localhost:8080/healthz"

start_svc "orchestrator" "$ROOT/orchestrator" \
  "PORT=4001 REPO_ROOT=$ROOT $TSNODE src/server.ts"
wait_ready "orchestrator" "http://localhost:4001/healthz"

start_svc "dashboard" "$ROOT/dashboard" \
  "DEMO_MODE=false ORCHESTRATOR_URL=http://localhost:4001 $NEXT_BIN dev -p 3001"
wait_ready "dashboard" "http://localhost:3001/"

echo ""
echo "==> All done"
echo "    demo-app:     http://localhost:3000"
echo "    shield:       http://localhost:8080"
echo "    orchestrator: http://localhost:4001"
echo "    dashboard:    http://localhost:3001"
echo ""
echo "    Logs   → scripts/.logs/"
echo "    Stop   → bash scripts/stop-all.sh"
echo "    Demo   → bash scripts/demo.sh"
