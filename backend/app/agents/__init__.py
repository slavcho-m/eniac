from typing import Dict

from .base import AgentBackend, AgentResult, ASSISTANT_TIERS, StageCapability, Tier
from .claude import ClaudeBackend
from .codex import CodexBackend

# Adding a 3rd backend: implement AgentBackend.run in a new module, register it here.
# Nothing else in this file or in runs.py needs to change.
BACKENDS: Dict[str, AgentBackend] = {
    "claude": ClaudeBackend(),
    "codex": CodexBackend(),
}

__all__ = [
    "AgentBackend",
    "AgentResult",
    "ASSISTANT_TIERS",
    "StageCapability",
    "Tier",
    "BACKENDS",
]
