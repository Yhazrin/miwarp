#!/usr/bin/env bash
# Start Tauri dev only when port 1420 is free. Never kills an existing dev server
# (Cursor agents often pkill + restart, which looks like "dev keeps dying").
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEV_PORT=1420

pids="$(lsof -ti :"$DEV_PORT" 2>/dev/null || true)"
if [[ -n "$pids" ]]; then
  echo "MiWarp dev already listening on :$DEV_PORT (PID: ${pids//$'\n'/ })"
  echo "Skipping start. Use the existing terminal or stop it manually (avoid pkill from agents)."
  exit 0
fi

exec npm run tauri dev
