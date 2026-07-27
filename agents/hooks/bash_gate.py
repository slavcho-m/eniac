#!/usr/bin/env python3
"""PreToolUse hook for the Bash tool, run by the `claude` CLI itself (not by Eniac's
backend process) for every Bash call an execution-stage Assistant makes. Registered via
`--settings` (see runs.py's `_bash_hook_settings`), stdlib-only so it needs no virtualenv
of its own — it runs as a bare `python3` subprocess of `claude`.

Asks the Eniac backend for a decision and blocks (polling) until one exists: an instant
"allowlisted" answer if the command matches `bash_allowlist`, otherwise a real wait for a
human to approve/deny via the UI. Fails closed (denies) on any error or timeout — never
silently allows a command Eniac couldn't get a real decision on.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

POLL_INTERVAL_SECONDS = 1.5
MAX_WAIT_SECONDS = 540  # under the CLI's 10-minute command-hook timeout


def _post(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read())


def _decision(permission_decision: str, reason: str = "") -> dict:
    output = {"hookEventName": "PreToolUse", "permissionDecision": permission_decision}
    if reason:
        output["permissionDecisionReason"] = reason
    return {"hookSpecificOutput": output}


def main() -> None:
    payload = json.load(sys.stdin)
    command = payload.get("tool_input", {}).get("command", "")
    cwd = payload.get("cwd", "")
    base_url = os.environ.get("ENIAC_BACKEND_URL", "http://localhost:1946")
    run_id = os.environ.get("ENIAC_RUN_ID")
    task_id = os.environ.get("ENIAC_TASK_ID")

    try:
        created = _post(
            f"{base_url}/bash-approvals",
            {"run_id": run_id, "task_id": task_id, "command": command, "cwd": cwd},
        )
    except (urllib.error.URLError, OSError, ValueError) as exc:
        print(json.dumps(_decision("deny", f"eniac: could not reach approval server ({exc})")))
        return

    approval_id = created["id"]
    latest = created
    deadline = time.time() + MAX_WAIT_SECONDS
    while latest["status"] == "pending" and time.time() < deadline:
        time.sleep(POLL_INTERVAL_SECONDS)
        try:
            latest = _get(f"{base_url}/bash-approvals/{approval_id}")
        except (urllib.error.URLError, OSError, ValueError):
            continue

    status = latest["status"]
    if status in ("approved", "allowlisted"):
        print(json.dumps(_decision("allow")))
    elif status == "pending":
        print(json.dumps(_decision("deny", "eniac: approval request timed out waiting for a human decision")))
    else:
        print(json.dumps(_decision("deny", latest.get("feedback") or "eniac: command denied by user")))


if __name__ == "__main__":
    main()
