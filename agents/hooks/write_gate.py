#!/usr/bin/env python3
"""PreToolUse hook for the Write tool during Discuss mode, run by the `claude` CLI itself
(not by Eniac's backend process). Discuss mode is granted Read/Grep/Glob into the real
project workspace (see runs.py's `discuss` branch) so it can answer questions grounded in
the actual code, but Write must never reach that workspace -- only this task's own sandbox
directory, where a user-requested generated file (e.g. "write me an architecture.md") is
meant to land. --safe-mode is off for this stage (needed for this very hook to fire at all
-- confirmed elsewhere in this codebase that --safe-mode silently disables all hooks), so
this is the only thing standing between "read the codebase" and "write to the codebase"
for this stage.

Purely local path-containment check -- no backend round-trip needed (unlike bash_gate.py,
which needs a human decision); this is a deterministic yes/no. Fails closed: an unset or
empty sandbox env var never allows a write.
"""
import json
import os
import sys


def _decision(allowed: bool, reason: str = "") -> dict:
    output = {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow" if allowed else "deny",
    }
    if reason:
        output["permissionDecisionReason"] = reason
    return {"hookSpecificOutput": output}


def main() -> None:
    payload = json.load(sys.stdin)
    path = payload.get("tool_input", {}).get("file_path", "")
    sandbox = os.environ.get("ENIAC_DISCUSSION_SANDBOX", "")

    resolved = os.path.realpath(path) if path else ""
    sandbox_resolved = os.path.realpath(sandbox) if sandbox else ""

    allowed = bool(sandbox_resolved) and (
        resolved == sandbox_resolved or resolved.startswith(sandbox_resolved + os.sep)
    )
    reason = "" if allowed else "eniac: Discuss mode can only write inside its own sandbox directory"
    print(json.dumps(_decision(allowed, reason)))


if __name__ == "__main__":
    main()
