#!/usr/bin/env bash
# stop-all.sh — stop all security-twin services
# Works in Git Bash (Windows) and WSL/Linux
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/scripts/.pids"

stop_svc() {
  local name="$1" pidfile="$PID_DIR/$name.pid"

  if [ ! -f "$pidfile" ]; then
    echo "  [$name] no pid file"
    return 0
  fi

  local pid
  pid=$(cat "$pidfile")
  printf "  Stopping %-14s" "$name..."

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    # Wait up to 3s, then force-kill
    for i in 1 2 3; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$pid" 2>/dev/null || true
    echo "  done"
  else
    echo "  already stopped"
  fi
  rm -f "$pidfile"
}

echo ""
echo "==> Stopping services"
for name in dashboard orchestrator shield demo-app; do
  stop_svc "$name"
done

# Port-based fallback — catches children the PID kill may have missed
echo ""
echo "==> Port cleanup"
for port in 3000 3001 4001 8080; do
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  for pid in $pids; do
    kill "$pid" 2>/dev/null && echo "  killed orphan :$port (pid=$pid)" || true
  done
done

echo ""
echo "==> All stopped"
