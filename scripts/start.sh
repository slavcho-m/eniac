#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT=1946
FRONTEND_PORT=5173
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
VENV="$BACKEND_DIR/.venv"
PID_FILE="$REPO_ROOT/.run.pids"

fail() {
  echo "eniac: $1" >&2
  exit 1
}

[ -x "$VENV/bin/uvicorn" ] || fail "backend isn't set up. Run 'make setup' first."
[ -d "$FRONTEND_DIR/node_modules" ] || fail "frontend isn't set up. Run 'make setup' first."

check_port_free() {
  if lsof -i ":$1" >/dev/null 2>&1; then
    fail "port $1 ($2) is already in use. Free it and retry."
  fi
}
check_port_free "$BACKEND_PORT" "backend"
check_port_free "$FRONTEND_PORT" "frontend"

echo "== Launch =="

FRONTEND_PID=""
(cd "$BACKEND_DIR" && exec "$VENV/bin/uvicorn" app.main:app --port "$BACKEND_PORT") &
BACKEND_PID=$!
trap 'rm -f "$PID_FILE"; kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null' EXIT

(cd "$FRONTEND_DIR" && exec npm run dev -- --port "$FRONTEND_PORT") &
FRONTEND_PID=$!

echo "$BACKEND_PID $FRONTEND_PID" > "$PID_FILE"

echo "Backend running at http://localhost:${BACKEND_PORT}"
echo "Frontend running at http://localhost:${FRONTEND_PORT}"
echo "Run 'make down' (from another terminal) to stop both."
wait "$BACKEND_PID" "$FRONTEND_PID"
