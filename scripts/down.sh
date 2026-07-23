#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$REPO_ROOT/.run.pids"

if [ ! -f "$PID_FILE" ]; then
  echo "eniac: nothing to stop (no $PID_FILE — is 'make start' running?)"
  exit 0
fi

read -r BACKEND_PID FRONTEND_PID < "$PID_FILE"

for pid in "$BACKEND_PID" "$FRONTEND_PID"; do
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    echo "Stopped PID $pid"
  else
    echo "PID $pid already stopped"
  fi
done

rm -f "$PID_FILE"
