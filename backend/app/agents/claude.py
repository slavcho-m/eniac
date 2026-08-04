from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Dict, List, Optional

from .base import (
    AgentBackend,
    AgentResult,
    BASH_GATE_HOOK_PATH,
    ENIAC_BACKEND_URL,
    StageCapability,
    WRITE_GATE_HOOK_PATH,
)

# tier -> Claude's own --tools value. "write" includes Grep/Glob even though execution's
# Implementation doesn't currently use them (it works off the Mastermind's file_plan
# instead) -- Decision/Diagram and Discuss mode's investigate-capable write DO need them,
# and one shared "write" tier can't grant Grep/Glob to two of its three callers but not the
# third. Harmless expansion for Implementation (unused tools, never called); real
# capability preserved for the other two.
TIER_TOOLS: Dict[str, str] = {
    "none": "",
    "investigate": "Read,Grep,Glob",
    "write": "Edit,Write,Read,Grep,Glob",
    "full": "Edit,Write,Read,Grep,Glob,Bash",
}


def _bash_hook_settings() -> str:
    """A `--settings` JSON string (confirmed via live spike: the CLI accepts an inline JSON
    string, not just a file path) registering the Bash-gating PreToolUse hook, without
    writing anything into the target workspace's own .claude/ directory."""
    return json.dumps(
        {
            "hooks": {
                "PreToolUse": [
                    {
                        "matcher": "Bash",
                        "hooks": [{"type": "command", "command": f"python3 {BASH_GATE_HOOK_PATH}"}],
                    }
                ]
            }
        }
    )


def _write_gate_settings() -> str:
    """Same mechanism as `_bash_hook_settings`, for Discuss mode's Write tool instead --
    confirmed via a live spike that a declarative `--settings` permissions.deny path rule
    is silently ignored under --permission-mode acceptEdits (the write went through anyway),
    while a real PreToolUse hook reliably blocks it. See write_gate.py for the actual check
    (path-containment against ENIAC_DISCUSSION_SANDBOX, set via this call's extra_env)."""
    return json.dumps(
        {
            "hooks": {
                "PreToolUse": [
                    {
                        "matcher": "Write",
                        "hooks": [{"type": "command", "command": f"python3 {WRITE_GATE_HOOK_PATH}"}],
                    }
                ]
            }
        }
    )


class ClaudeBackend(AgentBackend):
    name = "claude"

    # ponytail: hardcoded for now rather than a real settings UI -- see
    # docs/things-to-address.md for the "extend this into a real setting" note. Every value
    # here is either "sonnet" (unchanged from the default this was tuned against) or a
    # deliberate downgrade -- never a bump to a pricier model, since the point is spending
    # less, not more. Downgraded to "haiku": Test/Analysis/Discovery/Diagram, all cases where a
    # weak output is caught downstream rather than silently harmful (a bad test shows up in
    # your own diff review; a bad investigation report is just read and judged, not executed).
    # Kept at "sonnet": anything that ships as real code (Implementation), the safety net whose
    # whole job is catching problems (Review), anything every later stage reads (Supervisor's
    # scoping, Mastermind's requirements, Context Investigator's architecture docs, Design's
    # now-authoritative design doc), anything with real infra/deploy blast radius (CI-CD
    # Implementer, Environment), and genuinely hard, infrequent judgment calls (Decision).
    # "mastermind" is deliberately ONE key covering requirements/tasks/consultation, not three
    # separate ones -- tasks/consultation resume the requirements session, and switching models
    # on a resumed call forfeits part of the prompt cache (confirmed live: resuming with the
    # same model reused ~27.5k cached tokens for 173 new ones; resuming that same session with
    # a different model reused only ~15.6k and had to re-pay for ~5k fresh) -- tiering those
    # three differently would cost more, not less.
    ROLE_MODELS: Dict[str, str] = {
        "supervisor": "sonnet",
        "context_investigator": "sonnet",
        "mastermind": "sonnet",
        "Design": "sonnet",
        "Implementation": "sonnet",
        "Review": "sonnet",
        "Test": "haiku",
        "Analysis": "haiku",
        "CI-CD Implementer": "sonnet",
        "Environment": "sonnet",
        "Discovery": "haiku",
        "Decision": "sonnet",
        "Diagram": "haiku",
        "patch": "sonnet",
    }

    def _tool_flags_and_env(
        self, capability: StageCapability, run_id: str, task_id: str, cwd: Path, has_images: bool
    ) -> "tuple[List[str], Dict[str, str], List[str]]":
        extra_env: Dict[str, str] = {}
        add_dir_flags: List[str] = []

        if capability.tier == "write" and capability.confine_writes:
            # Discuss mode: Write only, never Edit (there's nothing to edit -- any file it
            # touches is one it's creating fresh in its own sandbox), plus WebSearch, plus
            # real-repo Read/Grep/Glob only when there's an actual workspace to read.
            tools: List[str] = []
            if capability.web_search:
                tools.append("WebSearch")
            tools.append("Write")
            if capability.read_workspace is not None:
                tools += ["Read", "Grep", "Glob"]
                add_dir_flags += ["--add-dir", str(capability.read_workspace)]
            if has_images and "Read" not in tools:
                tools.append("Read")
            tool_flags = [
                "--tools", ",".join(tools),
                "--permission-mode", "acceptEdits",
                "--settings", _write_gate_settings(),
            ]
            extra_env = {"ENIAC_DISCUSSION_SANDBOX": str(cwd)}
        elif capability.tier == "full":
            tool_flags = [
                "--tools", TIER_TOOLS["full"],
                "--permission-mode", "acceptEdits",
                "--settings", _bash_hook_settings(),
            ]
            extra_env = {"ENIAC_BACKEND_URL": ENIAC_BACKEND_URL, "ENIAC_RUN_ID": run_id, "ENIAC_TASK_ID": task_id}
        elif capability.tier == "write":
            # execution's Implementation/Decision/Diagram: writes the real workspace
            # directly (no confinement needed), no Bash, no hook.
            tool_flags = ["--tools", TIER_TOOLS["write"], "--safe-mode", "--permission-mode", "acceptEdits"]
        else:  # "none" / "investigate"
            tool_flags = ["--tools", TIER_TOOLS[capability.tier], "--safe-mode"]

        return tool_flags, extra_env, add_dir_flags

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
        item_id: Optional[str] = None,  # unused -- Claude's session identity lives in its own global store
    ) -> AgentResult:
        tool_flags, extra_env, add_dir_flags = self._tool_flags_and_env(
            capability, run_id, task_id, cwd, has_images=bool(image_paths)
        )

        if image_paths:
            # Read being in --tools isn't enough on its own for a path outside this stage's
            # own cwd -- --add-dir grants exactly those directories without loosening
            # anything else.
            for d in sorted({str(Path(p).parent) for p in image_paths}):
                add_dir_flags += ["--add-dir", d]

        model_flags = ["--model", self.model_for_stage(stage, assistant)]

        if resume_session_id is not None:
            command = [
                "claude", "-r", resume_session_id, "-p", prompt,
                "--output-format", "json", *tool_flags, *model_flags, *add_dir_flags,
            ]
        else:
            command = [
                "claude", "-p", prompt, "--output-format", "json",
                *tool_flags, *model_flags, *add_dir_flags,
            ]

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
            env={**os.environ, **extra_env} if extra_env else None,
        )
        lines: List[str] = []
        assert process.stdout is not None
        async for line in process.stdout:
            lines.append(line.decode(errors="replace"))
        await process.wait()
        transcript = "".join(lines)

        if process.returncode != 0:
            return AgentResult(False, process.returncode, None, None, transcript)

        wrapper = json.loads(transcript)
        return AgentResult(True, 0, wrapper["session_id"], wrapper["result"], transcript)
