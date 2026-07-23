from __future__ import annotations

import asyncio
import re
import uuid
from pathlib import Path
from typing import AsyncIterator, Dict

from . import db

REPO_ROOT = Path(__file__).resolve().parents[2]
SUPERVISOR_PROMPT_PATH = REPO_ROOT / "agents" / "supervisor" / "prompt.md"

_queues: Dict[str, "asyncio.Queue[str]"] = {}
_DONE = object()  # sentinel: signals stream_run to stop


def slugify(text: str, max_len: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_len].strip("-") or "task"


def new_run_id(stage: str, prompt: str) -> str:
    return f"{stage}-{slugify(prompt)}-{uuid.uuid4().hex[:8]}"


async def start_run(run_id: str, prompt: str) -> None:
    """Spawn `claude` for this run, push stdout lines onto its queue as they arrive."""
    queue: "asyncio.Queue[str]" = asyncio.Queue()
    _queues[run_id] = queue

    supervisor_prompt = SUPERVISOR_PROMPT_PATH.read_text()
    combined_prompt = f"{supervisor_prompt}\n\n---\n\nUser request:\n{prompt}"

    process = await asyncio.create_subprocess_exec(
        "claude", "-p", combined_prompt, "--output-format", "text",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    transcript_lines = []
    assert process.stdout is not None
    async for line in process.stdout:
        text = line.decode(errors="replace")
        transcript_lines.append(text)
        await queue.put(text)

    await process.wait()
    status = "completed" if process.returncode == 0 else "failed"
    db.complete_run(run_id, status, "".join(transcript_lines))
    await queue.put(_DONE)  # type: ignore[arg-type]


async def stream_run(run_id: str) -> AsyncIterator[str]:
    """Live-tail a run still in flight. Finished/unknown runs yield nothing.

    ponytail: no replay of a finished run's stored transcript — only proving the
    live pipe works right now. Add replay (read runs.transcript from db) if the
    UI needs to reconnect to a run that already completed.
    """
    queue = _queues.get(run_id)
    if queue is None:
        return
    while True:
        item = await queue.get()
        if item is _DONE:
            del _queues[run_id]
            break
        yield item
