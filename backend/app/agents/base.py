from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Dict, List, Literal, Optional

# backend/app/agents/base.py -> repo root is 3 parents up (agents, app, backend).
REPO_ROOT = Path(__file__).resolve().parents[3]
HOOKS_DIR = REPO_ROOT / "agents" / "hooks"
# Shared across backends: bash_gate.py (human-approval poll) is reused unmodified by both
# Claude's "full" tier and Codex's "full" tier. write_gate.py, bash_deny.py, and
# bash_readonly.py are each only used by one backend, but living next to the shared path
# here (rather than split across claude.py/codex.py) keeps every hook-script path in one
# place.
BASH_GATE_HOOK_PATH = HOOKS_DIR / "bash_gate.py"
WRITE_GATE_HOOK_PATH = HOOKS_DIR / "write_gate.py"
BASH_DENY_HOOK_PATH = HOOKS_DIR / "bash_deny.py"
BASH_READONLY_HOOK_PATH = HOOKS_DIR / "bash_readonly.py"

# The backend's own base URL, so a PreToolUse hook (a subprocess of whichever CLI is
# running, not of this process) knows where to POST/poll approval requests.
ENIAC_BACKEND_URL = os.environ.get("ENIAC_BACKEND_URL", "http://localhost:1946")

Tier = Literal["none", "investigate", "write", "full"]

# Agent-agnostic — replaces the old per-role ASSISTANT_TOOLS (a literal Claude --tools
# string per role). The 10 Assistant roles collapse into exactly 3 real capability tiers
# (Design/Analysis/Discovery/Review need to investigate but never write or execute;
# Implementation/Decision/Diagram need to write files but never run arbitrary shell;
# Test/CI-CD Implementer/Environment need both, gated per-command). Each backend maps a
# tier to its own concrete flags in its own module — this table never changes when a
# backend is added.
ASSISTANT_TIERS: Dict[str, Tier] = {
    "Design": "investigate",
    "Implementation": "write",
    "Review": "investigate",
    "Test": "full",
    "Analysis": "investigate",
    "CI-CD Implementer": "full",
    "Environment": "full",
    "Discovery": "investigate",
    "Decision": "write",
    "Diagram": "write",
}


@dataclass(frozen=True)
class StageCapability:
    """What one `start_run` call is allowed to do, independent of which backend runs it.
    `confine_writes`/`web_search`/`read_workspace` only ever apply to Discuss mode today —
    every other "write" caller (execution's Implementation/Decision/Diagram) writes
    directly into the real workspace by design, with no separate real-repo peek to grant."""

    tier: Tier
    confine_writes: bool = False
    web_search: bool = False
    read_workspace: Optional[Path] = None


@dataclass(frozen=True)
class AgentResult:
    """Normalized shape every backend's `run()` returns, regardless of that CLI's own
    output format (a single JSON blob for Claude, a JSONL event stream for Codex) — lets
    `start_run`'s per-stage envelope parsing (`_parse_supervisor_json` etc.) stay identical
    no matter which backend produced `result_text`."""

    success: bool
    returncode: Optional[int]
    session_id: Optional[str]  # None iff not success
    result_text: Optional[str]  # None iff not success
    raw_transcript: str  # stored verbatim into runs.transcript


def role_key_for_stage(stage: str, assistant: Optional[str] = None) -> str:
    """Resolves which ROLE_MODELS entry a given start_run call should use — moved verbatim
    from runs.py's old `_model_for_stage`. The key derivation was always agent-agnostic;
    only the table it indexed (Claude model names) was backend-specific. "context"/
    "discuss" -> the Supervisor; "requirements"/"tasks"/"consultation" all share the single
    "mastermind" entry (tiering those three differently would forfeit prompt-cache reuse
    across a resumed session — confirmed live for Claude, kept as the shared assumption
    here); "execution" is keyed by the assistant's own name, same granularity as
    ASSISTANT_TIERS; "patch" has its own entry."""
    if stage in ("context", "discuss"):
        return "supervisor"
    if stage in ("requirements", "tasks", "consultation"):
        return "mastermind"
    if stage == "patch":
        return "patch"
    assert stage == "execution" and assistant is not None
    return assistant


class AgentBackend(ABC):
    name: ClassVar[str]
    ROLE_MODELS: ClassVar[Dict[str, str]]

    def model_for_stage(self, stage: str, assistant: Optional[str] = None) -> str:
        return self.ROLE_MODELS[role_key_for_stage(stage, assistant)]

    @abstractmethod
    def is_authenticated(self) -> bool:
        """Whether this CLI is installed and logged in on this machine right now -- a
        quick, local, synchronous check (each backend's own auth-status subcommand, not a
        network call), used to decide which agents the UI offers at all. Must never raise:
        a missing binary or a malformed status response means "not available", not a
        crashed endpoint."""
        raise NotImplementedError

    @abstractmethod
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
        """Spawn this backend's CLI for one turn (fresh, or resumed via
        `resume_session_id`), wait for exit, return a normalized AgentResult. Owns: command
        construction, the tier -> concrete-flags mapping, model resolution (via
        `self.model_for_stage`), hook registration/lifecycle, and extracting
        (session_id, result_text) from whatever raw stdout shape this CLI produces.

        `item_id`, when given, identifies which task item's own conversation this call
        belongs to (execution stage only, where multiple items can run concurrently under
        the same task_id) -- backends that need a stable per-conversation identity (Codex:
        which on-disk session store to resume from) key off `item_id or task_id`; backends
        that don't (Claude: session identity lives entirely in the CLI's own global store)
        can ignore it.

        Must return `success=False` (never raise) on a clean non-zero process exit — may
        raise on a malformed/unparseable *successful* response, same contract
        `json.loads(transcript)` already had before this existed, caught by start_run's
        existing per-stage try/except.
        """
        raise NotImplementedError
