#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT=1946
FRONTEND_PORT=5173
ENIAC_HOME="${HOME}/.eniac"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "eniac: $1" >&2
  exit 1
}

echo "== Preflight checks =="

command -v python3 >/dev/null 2>&1 || fail "python3 not found. Install Python 3.9+ and retry."
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
  || fail "python3 $(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])') found, need 3.9+. Install a newer Python and retry."

command -v node >/dev/null 2>&1 || fail "node not found. Install Node 18+ and retry."
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 18 ] || fail "node $(node -v) found, need v18+. Install a newer Node and retry."

command -v npm >/dev/null 2>&1 || fail "npm not found (should ship with Node). Reinstall Node and retry."

command -v claude >/dev/null 2>&1 || fail "claude CLI not found. Install it (see https://docs.claude.com/claude-code) and retry."
claude auth status 2>/dev/null | grep -q '"loggedIn": true' \
  || fail "claude CLI is not authenticated. Run 'claude auth login' and retry."

check_port_free() {
  if lsof -i ":$1" >/dev/null 2>&1; then
    fail "port $1 ($2) is already in use. Free it and retry."
  fi
}
check_port_free "$BACKEND_PORT" "backend"
check_port_free "$FRONTEND_PORT" "frontend"

echo "Preflight OK."

echo "== ~/.eniac state =="

first_run_setup() {
  mkdir -p "$ENIAC_HOME/ppm" "$ENIAC_HOME/logs"
  echo '{}' > "$ENIAC_HOME/config.json"
  : > "$ENIAC_HOME/state.db" # ponytail: schema init belongs to the backend once it exists (build step 3)
  echo "Created ~/.eniac/."
  echo "Project creation is available from the UI once eniac is running — see docs/GETTING_STARTED.md."
}

if [ ! -d "$ENIAC_HOME" ]; then
  echo "No ~/.eniac/ found — first run."
  first_run_setup
else
  echo "~/.eniac/ found."
  read -r -p "Proceed with existing [Enter] / backup and reset [b] / wipe and reset [w]? " choice
  case "$choice" in
    b|B)
      backup="${ENIAC_HOME}.backup-$(date +%Y%m%d%H%M%S)"
      mv "$ENIAC_HOME" "$backup"
      echo "Backed up to $backup"
      first_run_setup
      ;;
    w|W)
      rm -rf "$ENIAC_HOME"
      echo "Wiped ~/.eniac/"
      first_run_setup
      ;;
    *)
      echo "Proceeding with existing ~/.eniac/."
      ;;
  esac
fi

echo "== Launch =="

BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"

if [ ! -f "$BACKEND_DIR/requirements.txt" ]; then
  fail "backend/ isn't set up yet (build step 3). Nothing to launch."
fi
if [ ! -f "$FRONTEND_DIR/package.json" ]; then
  fail "frontend/ isn't set up yet (build step 4). Nothing to launch."
fi

VENV="$BACKEND_DIR/.venv"
if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"

(cd "$BACKEND_DIR" && exec "$VENV/bin/uvicorn" app.main:app --port "$BACKEND_PORT") &
BACKEND_PID=$!
trap 'kill "$BACKEND_PID" 2>/dev/null' EXIT

# ponytail: frontend launch lands in build step 4 once frontend/ exists — this
# will `cd "$FRONTEND_DIR" && npm run dev -- --port $FRONTEND_PORT &`, then wait on both PIDs.
echo "Backend running at http://localhost:${BACKEND_PORT}"
wait "$BACKEND_PID"
