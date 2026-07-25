from __future__ import annotations

import asyncio
import json
import re
import subprocess
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from . import db

REPO_ROOT = Path(__file__).resolve().parents[2]
SUPERVISOR_PROMPT_PATH = REPO_ROOT / "agents" / "supervisor" / "prompt.md"
MASTERMINDS_DIR = REPO_ROOT / "agents" / "masterminds"
ASSISTANTS_DIR = REPO_ROOT / "agents" / "assistants"

KNOWN_MASTERMINDS = {"frontend", "backend", "devops", "architect"}

MASTERMIND_ASSISTANTS = {
    "frontend": {"Design", "Implementation", "Review", "Test"},
    "backend": {"Design", "Implementation", "Review", "Test"},
    "devops": {"Analysis", "CI-CD Implementer", "Environment"},
    "architect": {"Discovery", "Decision", "Diagram"},
}

# Tool access differs by Assistant type, unlike Masterminds (uniformly read-only investigate):
# Design/Implementation write code, Review only reads it. Test does NOT get Bash — arbitrary
# unattended command execution (bypassPermissions, no per-command approval possible in
# headless -p mode) is an unbounded risk unscoped by git-diff review, unlike Edit/Write which
# are path-scoped and fully revertible. Test just writes tests following existing conventions;
# a human runs them before approving, same as they'd review any other diff. Decided 2026-07-24
# after finding the alternative (a real per-command approval hook) would need a new blocking,
# synchronous approval mechanism this codebase doesn't have — not worth it for what's a
# convenience (auto-verifying pass/fail) rather than a core capability gap.
ASSISTANT_TOOLS = {
    "Design": "Edit,Write,Read,Grep,Glob",
    "Implementation": "Edit,Write,Read,Grep,Glob",
    "Review": "Read,Grep,Glob",
    "Test": "Edit,Write,Read,Grep,Glob",
}


def mastermind_prompt_path(mastermind: str) -> Path:
    return MASTERMINDS_DIR / mastermind / "prompt.md"


def assistant_prompt_path(mastermind: str, assistant: str) -> Path:
    return ASSISTANTS_DIR / mastermind / assistant.lower().replace(" ", "-") / "prompt.md"

_queues: Dict[str, "asyncio.Queue[str]"] = {}
_DONE = object()  # sentinel: signals stream_run to stop


def slugify(text: str, max_len: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_len].strip("-") or "task"


def new_run_id(stage: str, prompt: str) -> str:
    return f"{stage}-{slugify(prompt)}-{uuid.uuid4().hex[:8]}"


def _strip_fences(text: str) -> str:
    """Extract a fenced JSON block from anywhere in the text, not just the whole trimmed
    string — the model sometimes prepends prose (e.g. flagging a prompt-injection attempt
    from this user's global Claude Code hooks/plugins) before the actual JSON reply.
    """
    text = text.strip()
    match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if match:
        return match.group(1)
    return text


def _parse_needs_clarification(data: Dict[str, Any]) -> Dict[str, Any]:
    questions = data.get("questions")
    if not questions or not all(isinstance(q, str) for q in questions):
        raise ValueError(f"invalid questions: {questions}")
    return data


def _parse_supervisor_json(result_text: str) -> Dict[str, Any]:
    data = json.loads(_strip_fences(result_text))

    if data.get("status") == "needs_clarification":
        return _parse_needs_clarification(data)

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


def _parse_mastermind_json(result_text: str) -> Dict[str, Any]:
    data = json.loads(_strip_fences(result_text))

    if data.get("status") == "needs_clarification":
        return _parse_needs_clarification(data)

    if data.get("status") == "ready":
        required = {"summary", "requirements", "affected_files", "out_of_scope", "open_risks"}
        missing = required - data.keys()
        if missing:
            raise ValueError(f"missing keys: {missing}")
        if not data["requirements"]:
            raise ValueError("requirements must be non-empty")
        return data

    raise ValueError(f"unknown status: {data.get('status')!r}")


def _parse_tasks_json(result_text: str, mastermind: str) -> Dict[str, Any]:
    data = json.loads(_strip_fences(result_text))

    if data.get("status") == "needs_clarification":
        return _parse_needs_clarification(data)

    if data.get("status") == "ready":
        items = data.get("tasks")
        if not items:
            raise ValueError("tasks must be non-empty")
        valid_assistants = MASTERMIND_ASSISTANTS[mastermind]
        for item in items:
            if not {"slug", "description", "assistant"} <= item.keys():
                raise ValueError(f"invalid task item: {item}")
            if item["assistant"] not in valid_assistants:
                raise ValueError(f"invalid assistant: {item['assistant']!r}")
        return data

    raise ValueError(f"unknown status: {data.get('status')!r}")


def _parse_assistant_json(result_text: str) -> Dict[str, Any]:
    data = json.loads(_strip_fences(result_text))
    status_val = data.get("status")

    if status_val == "done":
        if "summary" not in data:
            raise ValueError("missing summary")
        return data

    if status_val == "blocked":
        if "reason" not in data:
            raise ValueError("missing reason")
        return data

    raise ValueError(f"unknown status: {status_val!r}")


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
    features_dir = db.PPM_ROOT / project_id / first_mastermind / "features"
    slug = data["feature_slug"]
    feature_dir = features_dir / slug
    suffix = 2
    while (feature_dir / "context.md").exists():
        feature_dir = features_dir / f"{slug}-{suffix}"
        suffix += 1
    data = {**data, "feature_slug": feature_dir.name}

    feature_dir.mkdir(parents=True, exist_ok=True)
    (feature_dir / "context.md").write_text(_render_context_md(data))
    db.set_task_context(task_id, data["feature_slug"], json.dumps(data["masterminds"]), session_id)


def _render_requirements_md(data: Dict[str, Any]) -> str:
    def bullets(items: List[str], empty: str) -> str:
        return "\n".join(f"- {item}" for item in items) if items else empty

    return f"""# Requirements

## Summary
{data['summary']}

## Requirements
{bullets(data['requirements'], "None.")}

## Affected Files
{bullets(data['affected_files'], "None identified.")}

## Out of Scope
{bullets(data['out_of_scope'], "None noted.")}

## Open Risks
{bullets(data['open_risks'], "None noted.")}
"""


def _write_requirements(
    project_id: str, task_id: str, mastermind: str, feature_slug: str, session_id: str, data: Dict[str, Any]
) -> None:
    feature_dir = db.PPM_ROOT / project_id / mastermind / "features" / feature_slug
    (feature_dir / "requirements.md").write_text(_render_requirements_md(data))
    db.set_task_requirements_ready(task_id, session_id)


def _render_tasks_md(items: List[Dict[str, Any]]) -> str:
    sections = []
    for i, item in enumerate(items, start=1):
        sections.append(
            f"## task{i}: {item['slug']}\n\n{item['description']}\n\n"
            f"**Recommended Assistant:** {item['assistant']}"
        )
    return "# Tasks\n\n" + "\n\n".join(sections) + "\n"


def _write_tasks(
    project_id: str, task_id: str, mastermind: str, feature_slug: str, session_id: str, data: Dict[str, Any]
) -> None:
    feature_dir = db.PPM_ROOT / project_id / mastermind / "features" / feature_slug
    (feature_dir / "tasks.md").write_text(_render_tasks_md(data["tasks"]))
    db.insert_task_items(task_id, data["tasks"])
    db.set_task_tasks_ready(task_id, session_id)


async def start_run(
    run_id: str,
    task_id: str,
    project_id: str,
    prompt: str,
    stage: str,
    resume_session_id: Optional[str] = None,
    mastermind: Optional[str] = None,
    workspace_path: Optional[str] = None,
    assistant: Optional[str] = None,
    item_id: Optional[str] = None,
) -> None:
    """Spawn `claude` for this run, push its reply onto the run's queue once it exits.

    Uses `--output-format json` (a single result blob at exit) rather than the plain-text
    line-by-line stream used elsewhere, since this stage needs the structured result plus
    session_id for clarification-round resumption via `-r`. Trade-off accepted: no live
    token-by-token streaming for this stage specifically.
    """
    queue: "asyncio.Queue[str]" = asyncio.Queue()
    _queues[run_id] = queue

    # Supervisor must not investigate code (agents/supervisor/prompt.md) — enforced via
    # --tools "" rather than prompt text alone. Masterminds investigate read-only.
    # Assistants (execution stage) get real Edit/Write tools since their job is to
    # actually change the codebase — reviewed via git diff afterward, not trusted blind.
    # All non-execution stages avoid inheriting this process's own cwd (this repo), which
    # would leak this dev session's own project-scoped auto-memory into the agent's
    # context, and get --safe-mode to disable this user's global hooks/plugins/CLAUDE.md
    # (e.g. a Ponytail persona hook observed leaking a "prompt injection" preamble into a
    # real run) without breaking normal OAuth auth, unlike --bare. Assistants deliberately
    # skip --safe-mode — user decision: normal hooks/plugins should stay active for the
    # stage that actually writes code.
    if stage == "context":
        cwd: Optional[Path] = db.PPM_ROOT / project_id
        tool_flags = ["--tools", "", "--safe-mode"]
    elif stage in ("requirements", "tasks"):
        assert workspace_path is not None
        cwd = Path(workspace_path).expanduser()
        tool_flags = ["--tools", "Read,Grep,Glob", "--safe-mode"]
    elif stage == "execution":
        assert workspace_path is not None and assistant is not None
        cwd = Path(workspace_path).expanduser()
        tools_str = ASSISTANT_TOOLS[assistant]
        tool_flags = ["--tools", tools_str]
        # Edit/Write/Bash being in --tools isn't enough in non-interactive -p mode — without
        # an explicit permission mode, the CLI denies the actual calls (found via two real
        # runs: "permission_denials" in the transcript, task_item stuck in-progress). Verified
        # empirically that acceptEdits (auto-accepts file edits, narrower than
        # bypassPermissions) does NOT cover Bash — every Bash call was still denied
        # ("This command requires approval") even with acceptEdits, and even when the model
        # itself tried dangerouslyDisableSandbox. Bash needs the broader bypassPermissions;
        # Edit/Write alone can stay on the narrower acceptEdits. Review gets neither — it has
        # no write tools, so there's nothing to grant permission for.
        if "Bash" in tools_str:
            tool_flags += ["--permission-mode", "bypassPermissions"]
        elif any(t in tools_str for t in ("Edit", "Write")):
            tool_flags += ["--permission-mode", "acceptEdits"]
    else:
        cwd = None
        tool_flags = []

    if resume_session_id is not None:
        command = ["claude", "-r", resume_session_id, "-p", prompt, "--output-format", "json", *tool_flags]
    else:
        if stage == "context":
            stage_prompt = SUPERVISOR_PROMPT_PATH.read_text()
        elif stage == "execution":
            assert mastermind is not None and assistant is not None
            stage_prompt = assistant_prompt_path(mastermind, assistant).read_text()
        else:
            assert mastermind is not None
            stage_prompt = mastermind_prompt_path(mastermind).read_text()
        label = "User request" if stage == "context" else "Input"
        combined_prompt = f"{stage_prompt}\n\n---\n\n{label}:\n{prompt}"
        command = ["claude", "-p", combined_prompt, "--output-format", "json", *tool_flags]

    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=cwd,
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

    elif stage == "requirements":
        if status == "completed":
            try:
                wrapper = json.loads(transcript)
                session_id = wrapper["session_id"]
                result_text = wrapper["result"]
                await queue.put(result_text)

                data = _parse_mastermind_json(result_text)
                if data["status"] == "needs_clarification":
                    db.set_task_awaiting_clarification(
                        task_id, session_id, json.dumps(data["questions"]),
                        status="awaiting_requirements_clarification",
                    )
                else:
                    assert mastermind is not None
                    task = db.get_task(task_id)
                    assert task is not None
                    _write_requirements(
                        project_id, task_id, mastermind, task["feature_slug"], session_id, data
                    )
            except Exception:
                db.mark_task_failed(task_id)
        else:
            db.mark_task_failed(task_id)

    elif stage == "tasks":
        if status == "completed":
            try:
                wrapper = json.loads(transcript)
                session_id = wrapper["session_id"]
                result_text = wrapper["result"]
                await queue.put(result_text)

                assert mastermind is not None
                data = _parse_tasks_json(result_text, mastermind)
                if data["status"] == "needs_clarification":
                    db.set_task_awaiting_clarification(
                        task_id, session_id, json.dumps(data["questions"]),
                        status="awaiting_tasks_clarification",
                    )
                else:
                    task = db.get_task(task_id)
                    assert task is not None
                    _write_tasks(
                        project_id, task_id, mastermind, task["feature_slug"], session_id, data
                    )
            except Exception:
                db.mark_task_failed(task_id)
        else:
            db.mark_task_failed(task_id)

    elif stage == "execution":
        assert item_id is not None
        if status == "completed":
            try:
                wrapper = json.loads(transcript)
                session_id = wrapper["session_id"]
                result_text = wrapper["result"]
                await queue.put(result_text)

                data = _parse_assistant_json(result_text)
                db.set_task_item_session(task_id, item_id, session_id)

                diff_result = subprocess.run(
                    ["git", "-C", str(cwd), "diff"], capture_output=True, text=True
                )
                db.set_run_diff(run_id, diff_result.stdout)

                if data["status"] == "done":
                    db.set_task_item_status(task_id, item_id, "awaiting_review")
                else:
                    # "blocked" — an Assistant can't self-resolve this; surface it as a
                    # failed task rather than leaving the item stuck in "in_progress".
                    db.mark_task_failed(task_id)
            except Exception:
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
