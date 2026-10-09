#!/usr/bin/env bash
# status.sh — show health of all security-twin services
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/scripts/.pids"

check() {
  local name="$1" port="$2" path="${3:-/healthz}"
  local http=false

  curl -sf --max-time 2 "http://localhost:$port$path" > /dev/null 2>&1 && http=true

  # lsof finds the real PID even when ts-node forks away from the saved subshell PID
  local pid
  pid=$(lsof -ti tcp:"$port" 2>/dev/null | head -1 || true)
  [ -z "$pid" ] && [ -f "$PID_DIR/$name.pid" ] && pid=$(cat "$PID_DIR/$name.pid")

  local pid_str="${pid:-—}"
  local run_str=$($http && echo 'UP' || echo 'DOWN')
  local http_str=$($http && echo 'HTTP OK' || echo 'HTTP --')

  printf "  %-14s  port=%-5s  pid=%-8s  %-6s  %s\n" \
    "$name" "$port" "$pid_str" "$run_str" "$http_str"
}

echo ""
echo "==> Service status"
check "demo-app"     3000
check "shield"       8080
check "orchestrator" 4001
check "dashboard"    3001 "/"
echo ""
