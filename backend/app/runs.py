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


def register_run(run_id: str) -> None:
    """Synchronously creates this run's message queue before the HTTP response handing
    `run_id` to the client goes out — closes a race where the client's WebSocket could
    connect and find no queue yet, since `start_run` is scheduled via `create_task` and
    isn't guaranteed to have run any of its own code by the time the client reconnects."""
    _queues[run_id] = asyncio.Queue()


def slugify(text: str, max_len: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_len].strip("-") or "task"


def new_run_id(stage: str, prompt: str) -> str:
    return f"{stage}-{slugify(prompt)}-{uuid.uuid4().hex[:8]}"


def _process_failure_reason(returncode: Optional[int], transcript: str) -> str:
    tail = transcript.strip()[-2000:] or "(no output)"
    return f"claude exited with code {returncode}:\n{tail}"


def _working_tree_diff(cwd: Path) -> str:
    """`git diff` alone omits untracked files entirely, so an Assistant creating a brand
    new file (not just editing existing ones) showed up as an empty diff — real bug found
    live against a real repo. Appends each untracked file (respecting .gitignore) as a
    `--no-index` add-diff, which produces the same `diff --git`/`new file mode` header
    shape as a tracked addition, so the frontend's parseDiff needs no changes."""
    tracked = subprocess.run(
        ["git", "-C", str(cwd), "diff"], capture_output=True, text=True
    ).stdout
    untracked_files = subprocess.run(
        ["git", "-C", str(cwd), "ls-files", "--others", "--exclude-standard"],
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    untracked_diffs = [
        subprocess.run(
            ["git", "-C", str(cwd), "diff", "--no-index", "/dev/null", path],
            capture_output=True,
            text=True,
        ).stdout
        for path in untracked_files
    ]
    return tracked + "".join(untracked_diffs)


def _extract_balanced_object(text: str) -> Optional[str]:
    """Finds the LAST balanced {...} object in text, tracking string literals so a brace
    character inside a JSON string value doesn't miscount depth. Tries every '{' as a
    candidate start and keeps the last one that successfully balances — not just the
    first — since the model's actual JSON reply is the trailing content per its own
    instructions; a stray brace earlier in prose (e.g. describing `{xs: 1}` syntax) would
    otherwise be mistaken for it by a first-match-only scanner."""
    best: Optional[str] = None
    start = text.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escaped = False
        end = None
        for i in range(start, len(text)):
            ch = text[i]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
            elif ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        if end is not None:
            # Resume *after* this match, not from inside it — a brace-like substring
            # inside this object's own string values (e.g. real content describing JSX
            # like `{storeLabel}`) must not be re-examined as its own candidate.
            best = text[start : end + 1]
            start = text.find("{", end + 1)
        else:
            start = text.find("{", start + 1)
    return best


def _strip_fences(text: str) -> str:
    """Extract the JSON reply from anywhere in the text, not just the whole trimmed
    string — the model sometimes prepends prose (e.g. flagging a prompt-injection attempt
    from this user's global Claude Code hooks/plugins, or confirming what it found) before
    the actual JSON reply, with or without a markdown fence around the JSON itself. Found
    live in production: a real reply prepended a sentence of prose before a raw, unfenced
    JSON object, which the old fence-only regex didn't catch, hard-failing an otherwise-
    correct run.
    """
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fenced:
        return fenced.group(1)
    raw = _extract_balanced_object(text)
    if raw is not None:
        return raw
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
    # register_run (called synchronously by the endpoint before this task was scheduled)
    # already created the queue in the normal case; setdefault covers any caller that
    # skipped it rather than depending on registration having happened.
    queue = _queues.setdefault(run_id, asyncio.Queue())

    # So a failed run can be replayed verbatim by /tasks/{id}/retry.
    db.set_run_replay_params(
        run_id,
        json.dumps(
            {
                "prompt": prompt,
                "resume_session_id": resume_session_id,
                "mastermind": mastermind,
                "workspace_path": workspace_path,
                "assistant": assistant,
            }
        ),
    )

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
            except Exception as exc:
                # Untrusted LLM output at a trust boundary: any parse/validation/IO
                # failure here must not leave the task stuck in "running" forever.
                db.mark_task_failed(task_id, f"Failed to process agent response: {exc}")
        else:
            db.mark_task_failed(task_id, _process_failure_reason(process.returncode, transcript))

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
            except Exception as exc:
                db.mark_task_failed(task_id, f"Failed to process agent response: {exc}")
        else:
            db.mark_task_failed(task_id, _process_failure_reason(process.returncode, transcript))

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
            except Exception as exc:
                db.mark_task_failed(task_id, f"Failed to process agent response: {exc}")
        else:
            db.mark_task_failed(task_id, _process_failure_reason(process.returncode, transcript))

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

                assert cwd is not None
                db.set_run_diff(run_id, _working_tree_diff(cwd), summary=data.get("summary"))

                if data["status"] == "done":
                    db.set_task_item_status(task_id, item_id, "awaiting_review")
                else:
                    # "blocked" — the Assistant is asking for guidance, not crashing.
                    # Only this item stops; the task and its other items stay alive,
                    # resolved the same way a rejected review is (resume + feedback).
                    db.set_task_item_blocked(task_id, item_id, data["reason"])
            except Exception as exc:
                db.mark_task_failed(task_id, f"Failed to process agent response: {exc}")
        else:
            db.mark_task_failed(task_id, _process_failure_reason(process.returncode, transcript))

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
