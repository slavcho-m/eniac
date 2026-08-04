#!/usr/bin/env python3
"""PreToolUse hook for the Bash tool, run by the `codex` CLI itself (not by Eniac's
backend process), for Discuss mode's Codex session. Codex has no separate Read/Grep/Glob
tool the way Claude does -- reading a file IS a shell command -- so Discuss mode's real
"answer questions about the codebase" capability depends on Bash staying available. This
denies anything that looks like a write or exfiltration attempt and allows everything else,
by substring match against a known-risky list rather than a strict allowlist parse.

That's deliberately looser than bash_gate.py's stance: the actual enforced boundary here is
the OS sandbox Eniac launches this Codex session under (`workspace-write`, with
`writable_roots` defaulted to the task's own sandbox cwd only, network access off by
default) -- confirmed at the sandbox level, not by this hook. This hook is defense-in-depth
against a command that would be merely embarrassing (e.g. deleting a file inside the
sandbox it could've deleted anyway), not the sole safety mechanism the way bash_gate.py's
human-approval poll is for the "full" tier's genuinely unconstrained shell access.

ponytail: substring denylist, not a real shell parser -- a determined adversarial prompt
could construct a command that evades every pattern here. Acceptable because the sandbox
is the real backstop (see above). Upgrade path if this ever needs to be load-bearing on its
own: Codex's own `execpolicy` .rules mechanism (Starlark-based command classification,
tested offline via `codex execpolicy check`) is the native equivalent -- see
docs/things-to-address.md.
"""
import json
import sys

# Substrings that indicate a write, mutation, or network/exfiltration attempt. Matched
# case-sensitively against the raw command string -- deliberately broad (e.g. "rm " catches
# `rm -rf`, `rm file.txt`) since false positives here just deny an investigation command
# Discuss mode can ask again more narrowly, not lose real capability.
_DENY_SUBSTRINGS = (
    ">", "<(",  # redirection / process substitution -- any of these can write
    "rm ", "rmdir ", "mv ", "cp ",
    "git commit", "git push", "git add", "git reset", "git checkout", "git clean", "git rm",
    "curl", "wget", "nc ", "ssh ", "scp ", "rsync",
    "chmod", "chown", "sudo",
    "npm install", "npm publish", "pip install", "pip3 install", "brew install",
    "dd ", "mkfs", "truncate",
    "kill ", "pkill", "shutdown", "reboot",
)


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
    command = payload.get("tool_input", {}).get("command", "")

    hit = next((s for s in _DENY_SUBSTRINGS if s in command), None)
    if hit is not None:
        print(json.dumps(_decision(False, f"eniac: Discuss mode is read-only here (matched {hit!r})")))
        return
    print(json.dumps(_decision(True)))


if __name__ == "__main__":
    main()
