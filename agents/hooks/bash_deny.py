#!/usr/bin/env python3
"""PreToolUse hook for the Bash tool, run by the `codex` CLI itself (not by Eniac's
backend process), for execution-stage Assistants whose tier is "write" (Implementation,
Decision, Diagram) -- roles that today already get zero Bash on Claude too (see
ASSISTANT_TIERS/TIER_TOOLS), so unconditionally denying here matches existing behavior
rather than restricting it further.

Unlike bash_gate.py, there's no human decision to poll for -- every Bash call under this
tier is out of scope, full stop.
"""
import json
import sys


def main() -> None:
    json.load(sys.stdin)  # consume the payload; nothing in it changes the decision
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "eniac: this role has no shell access -- structured file edits only",
        }
    }))


if __name__ == "__main__":
    main()
