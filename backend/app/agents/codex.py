from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from .base import (
    AgentBackend,
    AgentResult,
    BASH_DENY_HOOK_PATH,
    BASH_GATE_HOOK_PATH,
    BASH_READONLY_HOOK_PATH,
    ENIAC_BACKEND_URL,
    StageCapability,
)

# `--ignore-user-config` skips loading $CODEX_HOME/config.toml, but auth is looked up from
# CODEX_HOME regardless (confirmed live: pointing CODEX_HOME at an empty scratch dir with
# --ignore-user-config set produced a real 401 from the API, not a config-loading error) --
# so every scratch CODEX_HOME below needs a copy of the real auth.json or every call fails
# closed on auth, not just on the config/hooks isolation this is actually trying to achieve.
_REAL_CODEX_HOME = Path(os.environ.get("CODEX_HOME") or (Path.home() / ".codex"))

# Codex stores each thread's resumable session state under its own CODEX_HOME (confirmed
# live: `codex exec resume` failed with "no rollout found for thread id" once a
# per-call-ephemeral CODEX_HOME was torn down between the fresh call and its resume) -- so
# unlike the "one throwaway scratch dir per call" this started as, CODEX_HOME here has to
# persist for the life of one *conversation*, not one CLI invocation. Scoped by `item_id or
# task_id` (see AgentBackend.run's docstring) rather than task_id alone, so two execution
# items running concurrently under the same task -- each its own conversation, potentially
# a different capability tier -- never share (and race on) the same hooks.json. Never
# cleaned up -- consistent with the rest of Eniac's task-scoped state (PPM directories,
# task rows) never being auto-deleted either; see docs/things-to-address.md if disk usage
# ever becomes a real problem worth a cleanup pass.
_CODEX_HOME_ROOT = Path.home() / ".eniac" / "codex_home"


def _codex_home_for(session_key: str) -> Path:
    home = _CODEX_HOME_ROOT / session_key
    home.mkdir(parents=True, exist_ok=True)
    return home


def _resolve_codex_bin() -> str:
    """Codex's standalone installer puts the binary at ~/.local/bin/codex and adds that to
    PATH via a `.zprofile` snippet -- which only login shells source. Confirmed live: the
    Eniac backend server's own process (started via `uvicorn ...`, not a login shell) had no
    `~/.local/bin` on its PATH at all, so a bare `asyncio.create_subprocess_exec("codex", ...)`
    failed with FileNotFoundError on every real run -- silently stuck the task at "running"
    forever (see the runs.py fix for the "silently" half of that). `claude`'s Homebrew
    install location doesn't have this problem (already on the standard PATH everywhere), so
    this resolution is Codex-specific rather than something both backends need.
    """
    found = shutil.which("codex")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "codex"
    if fallback.is_file():
        return str(fallback)
    return "codex"  # let the subprocess call raise its own clear FileNotFoundError


_CODEX_BIN = _resolve_codex_bin()

# tier -> Codex's OS-enforced sandbox mode. "read-only" blocks every write and network
# attempt at the kernel level (confirmed via the Codex manual: network access is off by
# default in every sandbox mode, and read-only has no toggle to turn it on at all) --
# stronger than Claude's simple "no Edit/Write tool granted" for the same tier.
TIER_SANDBOX: Dict[str, str] = {
    "none": "read-only",
    "investigate": "read-only",
    "write": "workspace-write",
    "full": "workspace-write",
}


class CodexBackend(AgentBackend):
    name = "codex"

    # ponytail: every key defaults to the one confirmed-real model name in this machine's
    # own ~/.codex/config.toml -- no verified cheaper/faster Codex tier exists yet the way
    # Claude has "haiku". See docs/things-to-address.md; replace before relying on this for
    # cost tiering.
    ROLE_MODELS: Dict[str, str] = {
        key: "gpt-5.6-terra"
        for key in (
            "supervisor",
            "context_investigator",
            "mastermind",
            "Design",
            "Implementation",
            "Review",
            "Test",
            "Analysis",
            "CI-CD Implementer",
            "Environment",
            "Discovery",
            "Decision",
            "Diagram",
            "patch",
        )
    }

    def is_authenticated(self) -> bool:
        # `codex login status` exits 0 with "Logged in using ..." when authenticated, 1
        # with "Not logged in" otherwise (confirmed live against both a real login and a
        # scratch CODEX_HOME with no auth.json) -- explicitly pointed at the *real*
        # CODEX_HOME (not one of the per-conversation scratch dirs `run()` creates), since
        # this checks whether the user has ever actually logged in on this machine.
        try:
            result = subprocess.run(
                [_CODEX_BIN, "login", "status"],
                capture_output=True,
                text=True,
                timeout=10,
                env={**os.environ, "CODEX_HOME": str(_REAL_CODEX_HOME)},
            )
            return result.returncode == 0
        except (subprocess.SubprocessError, OSError):
            return False

    def _hooks_and_env(
        self, capability: StageCapability, run_id: str, task_id: str
    ) -> "Tuple[str, Dict[str, str]]":
        hooks: Dict[str, object] = {"hooks": {"PreToolUse": []}}
        pre_tool_use: List[dict] = hooks["hooks"]["PreToolUse"]  # type: ignore[assignment]
        extra_env: Dict[str, str] = {}

        if capability.tier == "write" and capability.confine_writes:
            # Discuss mode: needs real read/search capability (Read,Grep,Glob's worth, on
            # the Claude side) but must never write outside cwd. Codex has no separate
            # search tool -- reading IS Bash -- so denying Bash outright here would
            # silently strip Discuss mode's whole "answer questions about the real repo"
            # capability. This is a denylist classifier, not the blunt always-deny used
            # below: the OS sandbox (workspace-write, writable_roots defaulted to [cwd]
            # only, network off) is the actual enforced boundary here -- this hook is
            # defense-in-depth against a command that's merely embarrassing, not the sole
            # safety mechanism the way bash_gate.py's human approval is for "full".
            pre_tool_use.append(
                {
                    "matcher": "Bash",
                    "hooks": [{"type": "command", "command": f"python3 {BASH_READONLY_HOOK_PATH}"}],
                }
            )
        elif capability.tier == "write":
            # execution's Implementation/Decision/Diagram: today's ASSISTANT_TIERS already
            # grants these roles zero Bash on Claude too -- matching that, not a regression.
            pre_tool_use.append(
                {
                    "matcher": "Bash",
                    "hooks": [{"type": "command", "command": f"python3 {BASH_DENY_HOOK_PATH}"}],
                }
            )
        elif capability.tier == "full":
            pre_tool_use.append(
                {
                    "matcher": "Bash",
                    "hooks": [{"type": "command", "command": f"python3 {BASH_GATE_HOOK_PATH}"}],
                }
            )
            extra_env = {"ENIAC_BACKEND_URL": ENIAC_BACKEND_URL, "ENIAC_RUN_ID": run_id, "ENIAC_TASK_ID": task_id}
        # tier == "investigate"/"none": no hook needed -- --sandbox read-only already
        # blocks every write/network attempt at the OS level; Bash stays available for
        # read/search (or is disabled outright for "none" via features.shell_tool=false).

        return json.dumps(hooks), extra_env

    async def run(
        self,
        *,
        run_id: str,
        task_id: str,
        prompt: str,
        stage: str,
        assistant: Optional[str],
        cwd: Path,
        capability: StageCapability,
        resume_session_id: Optional[str] = None,
        image_paths: Optional[List[str]] = None,
        item_id: Optional[str] = None,
    ) -> AgentResult:
        # ponytail: no -a/--ask-for-approval here -- confirmed live that `codex exec` (as
        # opposed to the top-level interactive `codex`) doesn't accept that flag at all
        # ("unexpected argument '-a'"). `codex exec` is non-interactive by construction, so
        # there's no approval prompt to skip in the first place -- sandbox mode plus the
        # PreToolUse hooks registered below are the only gates that apply here.
        flags = [
            "--skip-git-repo-check",
            "--ignore-user-config",
            "--ignore-rules",
            "--dangerously-bypass-hook-trust",
        ]
        # `--sandbox`/`-C` only exist on a fresh `codex exec` -- confirmed live: `codex exec
        # resume` rejects both ("unexpected argument '--sandbox' found"). A resumed thread
        # keeps the sandbox/cwd its fresh call originally set, so there's nothing to
        # re-specify -- but the *subprocess itself* still needs `cwd=cwd` (below) since
        # there's no `-C` to fall back on for a resumed launch.
        if resume_session_id is None:
            flags += ["--sandbox", TIER_SANDBOX[capability.tier], "-C", str(cwd)]
        if capability.tier == "none":
            # Mirrors Claude's --tools "" -- kills the shell tool entirely rather than just
            # relying on the sandbox, since read-only alone would still let it run harmless
            # read commands the Supervisor/title-gen stage has no reason to need at all.
            flags += ["-c", "features.shell_tool=false"]
        if capability.web_search:
            # ponytail: candidate mechanism from the config schema (`web_search = "live"`),
            # not yet confirmed against a live `codex exec` run. See
            # docs/things-to-address.md -- verify before relying on this for Discuss mode.
            flags += ["-c", "web_search=live"]
        # capability.read_workspace: no flag needed. Codex's sandbox only gates
        # writes/network, not reads, on macOS/Linux (writable_roots is the only per-dir
        # sandbox knob outside Windows) -- the real workspace is already readable with zero
        # extra grant. Its path still reaches the model via runs.py's own prompt text
        # (workspace_guidance), same as every other stage.

        model_flags = ["-m", self.model_for_stage(stage, assistant)]
        image_flags = [flag for p in (image_paths or []) for flag in ("-i", p)]
        hooks_json, extra_env = self._hooks_and_env(capability, run_id, task_id)

        codex_home = _codex_home_for(item_id or task_id)
        real_auth = _REAL_CODEX_HOME / "auth.json"
        if real_auth.is_file():
            shutil.copy(real_auth, codex_home / "auth.json")
        (codex_home / "hooks.json").write_text(hooks_json)

        # `codex exec resume` requires its options before the positional
        # <SESSION_ID> <PROMPT> args -- confirmed live: options placed after them fail
        # with "unexpected argument '--sandbox' found" (the parser stops accepting
        # flags once it starts consuming free-text positionals). Fresh `codex exec`
        # tolerates either order, but building both the same way (options first) is one
        # less thing to keep straight.
        options = ["--json", *flags, *model_flags, *image_flags]
        if resume_session_id is not None:
            command = [_CODEX_BIN, "exec", "resume", *options, resume_session_id, prompt]
        else:
            command = [_CODEX_BIN, "exec", *options, prompt]

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
            env={**os.environ, "CODEX_HOME": str(codex_home), **extra_env},
        )
        lines: List[str] = []
        assert process.stdout is not None
        async for line in process.stdout:
            lines.append(line.decode(errors="replace"))
        await process.wait()

        transcript = "".join(lines)

        if process.returncode != 0:
            return AgentResult(False, process.returncode, None, None, transcript)

        session_id, result_text = self._parse_jsonl(transcript)
        return AgentResult(True, 0, session_id, result_text, transcript)

    def _parse_jsonl(self, transcript: str) -> Tuple[str, str]:
        """Confirmed live (`codex exec "..." --json`): the first line is
        {"type":"thread.started","thread_id":...}; the model's reply is the last
        {"type":"item.completed","item":{"type":"agent_message","text":...}}. Raises if
        either is missing -- same "malformed successful response" contract
        json.loads(transcript) already had, caught by start_run's per-stage try/except."""
        session_id: Optional[str] = None
        result_text: Optional[str] = None
        for line in transcript.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "thread.started":
                session_id = event.get("thread_id")
            elif event.get("type") == "item.completed":
                item = event.get("item") or {}
                if item.get("type") == "agent_message":
                    result_text = item.get("text")
        if session_id is None or result_text is None:
            raise ValueError(f"could not extract session_id/result_text from codex output: {transcript[-2000:]!r}")
        return session_id, result_text
