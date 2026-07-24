from __future__ import annotations

import asyncio
import json
import re
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from . import db

REPO_ROOT = Path(__file__).resolve().parents[2]
SUPERVISOR_PROMPT_PATH = REPO_ROOT / "agents" / "supervisor" / "prompt.md"

KNOWN_MASTERMINDS = {"frontend", "backend", "devops", "architect"}

_queues: Dict[str, "asyncio.Queue[str]"] = {}
_DONE = object()  # sentinel: signals stream_run to stop


def slugify(text: str, max_len: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_len].strip("-") or "task"


def new_run_id(stage: str, prompt: str) -> str:
    return f"{stage}-{slugify(prompt)}-{uuid.uuid4().hex[:8]}"


def _parse_supervisor_json(result_text: str) -> Dict[str, Any]:
    text = result_text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    data = json.loads(text)

    if data.get("status") == "needs_clarification":
        questions = data["questions"]
        if not questions or not all(isinstance(q, str) for q in questions):
            raise ValueError(f"invalid questions: {questions}")
        return data

    if data.get("status") == "ready":
        required = {"feature_slug", "goal", "constraints", "masterminds", "reasoning"}
        missing = required - data.keys()
        if missing:
            raise ValueError(f"missing keys: {missing}")
        masterminds = data["masterminds"]
        if not masterminds or not all(m in KNOWN_MASTERMINDS for m in masterminds):
            raise ValueError(f"invalid masterminds: {masterminds}")
        return data

    raise ValueError(f"unknown status: {data.get('status')!r}")


def _render_context_md(data: Dict[str, Any]) -> str:
    def bullets(items: List[str], empty: str) -> str:
        return "\n".join(f"- {item}" for item in items) if items else empty

    ordering = "\n".join(f"{i + 1}. {m}" for i, m in enumerate(data["masterminds"]))

    return f"""# Context: {data['feature_slug']}

## Goal
{data['goal']}

## Constraints
{bullets(data['constraints'], "None noted.")}

## Mastermind Ordering
{ordering}

**Reasoning:** {data['reasoning']}
"""


def _write_context(project_id: str, task_id: str, session_id: str, data: Dict[str, Any]) -> None:
    first_mastermind = data["masterminds"][0]
    feature_dir = db.PPM_ROOT / project_id / first_mastermind / "features" / data["feature_slug"]
    feature_dir.mkdir(parents=True, exist_ok=True)
    (feature_dir / "context.md").write_text(_render_context_md(data))
    db.set_task_context(task_id, data["feature_slug"], json.dumps(data["masterminds"]), session_id)


async def start_run(
    run_id: str,
    task_id: str,
    project_id: str,
    prompt: str,
    stage: str,
    resume_session_id: Optional[str] = None,
) -> None:
    """Spawn `claude` for this run, push its reply onto the run's queue once it exits.

    Uses `--output-format json` (a single result blob at exit) rather than the plain-text
    line-by-line stream used elsewhere, since this stage needs the structured result plus
    session_id for clarification-round resumption via `-r`. Trade-off accepted: no live
    token-by-token streaming for this stage specifically.
    """
    queue: "asyncio.Queue[str]" = asyncio.Queue()
    _queues[run_id] = queue

    if resume_session_id is not None:
        command = ["claude", "-r", resume_session_id, "-p", prompt, "--output-format", "json"]
    else:
        supervisor_prompt = SUPERVISOR_PROMPT_PATH.read_text()
        combined_prompt = f"{supervisor_prompt}\n\n---\n\nUser request:\n{prompt}"
        command = ["claude", "-p", combined_prompt, "--output-format", "json"]

    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    transcript_lines = []
    assert process.stdout is not None
    async for line in process.stdout:
        transcript_lines.append(line.decode(errors="replace"))

    await process.wait()
    transcript = "".join(transcript_lines)
    status = "completed" if process.returncode == 0 else "failed"
    db.complete_run(run_id, status, transcript)

    if stage == "context":
        if status == "completed":
            try:
                wrapper = json.loads(transcript)
                session_id = wrapper["session_id"]
                result_text = wrapper["result"]
                await queue.put(result_text)

                data = _parse_supervisor_json(result_text)
                if data["status"] == "needs_clarification":
                    db.set_task_awaiting_clarification(
                        task_id, session_id, json.dumps(data["questions"])
                    )
                else:
                    _write_context(project_id, task_id, session_id, data)
            except Exception:
                # Untrusted LLM output at a trust boundary: any parse/validation/IO
                # failure here must not leave the task stuck in "running" forever.
                db.mark_task_failed(task_id)
        else:
            db.mark_task_failed(task_id)

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
