from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import tempfile
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
# Design/Implementation write code, Review only reads it. Analysis (DevOps) is investigation
# only, same read-only stance as Review. Test, CI-CD Implementer, and Environment get real
# Bash — every call is gated per-command by a PreToolUse hook (agents/hooks/bash_gate.py,
# wired in below) that asks the Eniac backend for a decision: an instant answer if the exact
# command is already on the `bash_allowlist`, otherwise a real wait for a human to approve/
# deny/allowlist it via the UI. This replaced an earlier all-or-nothing `bypassPermissions`
# grant (tried for Test on 2026-07-24, reverted the same day — no per-command gate, an
# unbounded risk unscoped by git-diff review, unlike Edit/Write which are path-scoped and
# fully revertible) once the hook mechanism was built and verified live. See
# [[eniac-no-unattended-bash]] for that history — this supersedes it, not contradicts it.
ASSISTANT_TOOLS = {
    "Design": "Edit,Write,Read,Grep,Glob",
    "Implementation": "Edit,Write,Read,Grep,Glob",
    "Review": "Read,Grep,Glob",
    "Test": "Edit,Write,Read,Grep,Glob,Bash",
    "Analysis": "Read,Grep,Glob",
    "CI-CD Implementer": "Edit,Write,Read,Grep,Glob,Bash",
    "Environment": "Edit,Write,Read,Grep,Glob,Bash",
}

# The backend's own base URL, so the PreToolUse hook (a subprocess of `claude`, not of this
# process) knows where to POST/poll approval requests. No prior "my own base URL" concept
# existed in this codebase (port 1946 was only ever hardcoded in scripts/start.sh) — this
# introduces it minimally, overridable via env, defaulting to the documented dev port.
ENIAC_BACKEND_URL = os.environ.get("ENIAC_BACKEND_URL", "http://localhost:1946")
BASH_GATE_HOOK_PATH = REPO_ROOT / "agents" / "hooks" / "bash_gate.py"


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


# On a fresh call, the stage's prompt.md carries the JSON-output contract. A resumed call
# (-r) sends only the new turn's text, relying on the model to recall that contract purely
# from conversation history — which drifts over enough turns (seen live: a 15-turn execution
# resume replied in plain prose instead of {"status": "done", ...}, crashing json.loads).
# Re-asserting the shape on every resumed turn costs a couple lines of prompt, not a full
# prompt.md re-send, and keeps the contract from depending on how long the session has run.
_RESUME_REMINDERS = {
    "context": (
        'Reminder: respond with only a single JSON object -- no markdown fences, no prose '
        'before or after it -- either {"status": "needs_clarification", "questions": [...]} '
        'or {"status": "ready", "feature_slug": ..., "goal": ..., "constraints": [...], '
        '"masterminds": [...], "reasoning": ...}.'
    ),
    "requirements": (
        'Reminder: respond with only a single JSON object -- no markdown fences, no prose '
        'before or after it -- either {"status": "needs_clarification", "questions": [...]} '
        'or {"status": "ready", "summary": ..., "requirements": [...], "affected_files": [...], '
        '"out_of_scope": [...], "open_risks": [...]}.'
    ),
    "tasks": (
        'Reminder: respond with only a single JSON object -- no markdown fences, no prose '
        'before or after it -- either {"status": "needs_clarification", "questions": [...]} '
        'or {"status": "ready", "tasks": [{"slug": ..., "description": ..., "assistant": ..., '
        '"depends_on": [...]}, ...]}.'
    ),
    "execution": (
        'Reminder: respond with only a single JSON object -- no markdown fences, no prose '
        'before or after it -- either {"status": "done", "summary": ...} or '
        '{"status": "blocked", "reason": ...}.'
    ),
    "consultation": (
        'Reminder: respond with only a single JSON object -- no markdown fences, no prose '
        'before or after it -- either {"status": "needs_clarification", "questions": [...]} '
        'or {"status": "ready", "new_tasks": [...], "deprecate_item_ids": [...], "reasoning": ...}.'
    ),
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


def _snapshot_tree(cwd: Path) -> str:
    """Writes a real git tree object for the current working tree (tracked edits +
    untracked files, respecting .gitignore) without touching the repo's actual index —
    `add -A`/`write-tree` run against a throwaway `GIT_INDEX_FILE` that's discarded when
    this returns, so `git status` sees nothing different."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp_dir) / "index")}
        subprocess.run(["git", "-C", str(cwd), "add", "-A"], env=env, check=True)
        return subprocess.run(
            ["git", "-C", str(cwd), "write-tree"], env=env, capture_output=True, text=True, check=True
        ).stdout.strip()


def create_checkpoint(cwd: Path) -> str:
    """Snapshots the current working tree into a real commit object, without moving any
    ref, branch, or HEAD. Eniac never auto-commits (the user reviews diffs before anything
    becomes a real commit); this stays true to that since `git status`/`git log` see
    nothing different, but gives us a real git object to diff/restore against instead of a
    hand-rolled patch-text snapshot.

    Used both to isolate one task item's own diff from earlier items' uncommitted changes
    (`working_tree_diff(cwd, since=checkpoint)`), and to cleanly revert to exactly this
    point on reject (`restore_checkpoint`).
    """
    tree = _snapshot_tree(cwd)
    head = subprocess.run(["git", "-C", str(cwd), "rev-parse", "HEAD"], capture_output=True, text=True)
    commit_cmd = ["git", "-C", str(cwd), "commit-tree", tree, "-m", "eniac checkpoint"]
    if head.returncode == 0:
        commit_cmd += ["-p", head.stdout.strip()]
    return subprocess.run(commit_cmd, capture_output=True, text=True, check=True).stdout.strip()


def restore_checkpoint(cwd: Path, checkpoint: str) -> None:
    """Resets the working tree back to exactly what `checkpoint` recorded — used when a
    task item is rejected, to undo just that item's changes without touching earlier
    items in the same task that are already approved but still deliberately uncommitted.

    `read-tree --reset -u` handles every path that was in the real index, but Eniac never
    stages anything for real, so a file a rejected item newly created was never in the
    real index to begin with — `read-tree` has no record to remove it by, and leaves it
    sitting on disk. Cleaned up here as an explicit second pass: any currently-untracked
    file that isn't part of the checkpoint's own tree gets deleted directly.
    """
    subprocess.run(["git", "-C", str(cwd), "read-tree", "--reset", "-u", checkpoint], check=False)
    untracked = subprocess.run(
        ["git", "-C", str(cwd), "ls-files", "--others", "--exclude-standard"],
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    for path in untracked:
        in_checkpoint = (
            subprocess.run(
                ["git", "-C", str(cwd), "cat-file", "-e", f"{checkpoint}:{path}"],
                capture_output=True,
            ).returncode
            == 0
        )
        if not in_checkpoint:
            (cwd / path).unlink(missing_ok=True)


def working_tree_diff(cwd: Path, since: Optional[str] = None) -> str:
    """Diffs the working tree against `since` (a checkpoint commit) if given, or HEAD
    otherwise. Snapshots the current state into its own tree first and does a plain
    tree-to-tree `git diff`, rather than comparing against the repo's real index.

    That matters for untracked files specifically: an earlier version of this function did
    a plain `git diff` (tracked only) plus a manual per-untracked-file `--no-index` pass —
    but `git diff <commit>` resolves *presence* against the real index, not the working
    directory, so a path that exists in `since`'s tree yet was never added to the real repo
    index (true of every untracked file Eniac ever creates) showed up as a bogus full
    delete from that pass, *and* as a bogus brand-new file from the manual untracked pass —
    one real edit rendered as two contradictory diffs. Comparing two real trees sidesteps
    the real index entirely, so a file edited across two checkpoints — tracked or not —
    always nets out to exactly one incremental diff.
    """
    current_tree = _snapshot_tree(cwd)
    base = since if since else "HEAD"
    return subprocess.run(
        ["git", "-C", str(cwd), "diff", base, current_tree], capture_output=True, text=True
    ).stdout


def text_diff(old_content: str, new_content: str, filename: str) -> str:
    """A unified diff between two in-memory text blobs (e.g. a tasks.md amendment's before/
    after), formatted exactly like real `git diff` output so the frontend's existing
    parseDiff/DiffViewer render it with zero changes — same `git diff --no-index` technique
    used elsewhere in this file for untracked files, git as the diffing engine, header
    rewritten so the displayed filename is clean rather than a temp path."""
    if old_content == new_content:
        return ""
    with tempfile.TemporaryDirectory() as tmp_dir:
        old_path = Path(tmp_dir) / "old"
        new_path = Path(tmp_dir) / "new"
        old_path.write_text(old_content)
        new_path.write_text(new_content)
        result = subprocess.run(
            ["git", "diff", "--no-index", "--", str(old_path), str(new_path)],
            capture_output=True,
            text=True,
        )
    body_lines = result.stdout.splitlines()
    hunk_start = next((i for i, line in enumerate(body_lines) if line.startswith("@@")), None)
    if hunk_start is None:
        return ""
    header = f"diff --git a/{filename} b/{filename}\n--- a/{filename}\n+++ b/{filename}\n"
    return header + "\n".join(body_lines[hunk_start:]) + "\n"


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


def _parse_assistant_json(result_text: str, mastermind: Optional[str] = None) -> Dict[str, Any]:
    data = json.loads(_strip_fences(result_text))
    status_val = data.get("status")

    if status_val == "done":
        if "summary" not in data:
            raise ValueError("missing summary")
        new_tasks = data.get("new_tasks")
        if new_tasks:
            # An Assistant (Review, today) proposing task items — validated the same way a
            # Mastermind's own tasks.md items are, so a bad proposal fails loudly here
            # rather than silently staging garbage.
            valid_assistants = MASTERMIND_ASSISTANTS[mastermind] if mastermind else None
            for item in new_tasks:
                if not {"slug", "description", "assistant"} <= item.keys():
                    raise ValueError(f"invalid proposed task item: {item}")
                if valid_assistants and item["assistant"] not in valid_assistants:
                    raise ValueError(f"invalid assistant in proposed task: {item['assistant']!r}")
        return data

    if status_val == "blocked":
        if "reason" not in data:
            raise ValueError("missing reason")
        return data

    raise ValueError(f"unknown status: {status_val!r}")


def _parse_consultation_json(result_text: str, mastermind: str) -> Dict[str, Any]:
    data = json.loads(_strip_fences(result_text))

    if data.get("status") == "needs_clarification":
        return _parse_needs_clarification(data)

    if data.get("status") == "ready":
        required = {"new_tasks", "deprecate_item_ids", "reasoning"}
        missing = required - data.keys()
        if missing:
            raise ValueError(f"missing keys: {missing}")
        valid_assistants = MASTERMIND_ASSISTANTS[mastermind]
        for item in data["new_tasks"]:
            if not {"slug", "description", "assistant"} <= item.keys():
                raise ValueError(f"invalid task item: {item}")
            if item["assistant"] not in valid_assistants:
                raise ValueError(f"invalid assistant: {item['assistant']!r}")
        if not data["new_tasks"] and not data["deprecate_item_ids"]:
            raise ValueError("consultation must propose at least one new task or deprecation")
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


def _resolve_slug_references(
    task_id: str, new_tasks: List[Dict[str, Any]], deprecate_refs: Optional[List[str]] = None
):
    """`depends_on`/`deprecate_item_ids` from a Review proposal or Mastermind consultation
    can reference an item by its real item_id (task2) or by slug (write-multiply-tests) —
    found live: a real consultation response used slugs throughout despite the prompt's
    item_id-shaped example, a more natural identifier for a model reasoning about the task
    list than its incidental position label. Rather than fight that, resolve either shape
    here — same slug-to-item_id lookup `_write_tasks` already does at original creation
    time, extended to also cover newly-proposed items referencing each other within the
    same batch (assigned the same provisional item_ids `append_task_items` will really use).
    Falls back to the given value unchanged if it doesn't match any known slug, so an
    already-real item_id passes through untouched.
    """
    existing = db.get_task_items(task_id)
    slug_to_item_id = {item["slug"]: item["item_id"] for item in existing}
    next_n = len(existing) + 1
    for offset, item in enumerate(new_tasks):
        slug_to_item_id.setdefault(item["slug"], f"task{next_n + offset}")

    resolved_new_tasks = [
        {**item, "depends_on": [slug_to_item_id.get(s, s) for s in item.get("depends_on", [])]}
        for item in new_tasks
    ]
    resolved_deprecate = (
        [slug_to_item_id.get(s, s) for s in deprecate_refs] if deprecate_refs is not None else None
    )
    return resolved_new_tasks, resolved_deprecate


def _write_requirements(
    project_id: str, task_id: str, mastermind: str, feature_slug: str, session_id: str, data: Dict[str, Any]
) -> None:
    feature_dir = db.PPM_ROOT / project_id / mastermind / "features" / feature_slug
    (feature_dir / "requirements.md").write_text(_render_requirements_md(data))
    db.set_task_requirements_ready(task_id, session_id)


def render_tasks_md(items: List[Dict[str, Any]]) -> str:
    """Each item may optionally carry `item_id` (falls back to positional `task{i}` at
    original creation time, when items don't have one assigned yet), `deprecated`/
    `deprecated_reason` (an approved amendment superseded it), and `depends_on` (item_ids
    it builds on) — one renderer used both for the original write and for re-rendering an
    amended document, not two."""
    sections = []
    for i, item in enumerate(items, start=1):
        item_id = item.get("item_id") or f"task{i}"
        label = f"{item_id}: {item['slug']}"
        if item.get("deprecated"):
            reason = item.get("deprecated_reason") or "superseded"
            heading = f"## ~~{label}~~ (deprecated — {reason})"
        else:
            heading = f"## {label}"
        section = f"{heading}\n\n{item['description']}\n\n**Recommended Assistant:** {item['assistant']}"
        depends_on = item.get("depends_on")
        if depends_on:
            section += f"\n\n**Depends on:** {', '.join(depends_on)}"
        sections.append(section)
    return "# Tasks\n\n" + "\n\n".join(sections) + "\n"


def _write_tasks(
    project_id: str, task_id: str, mastermind: str, feature_slug: str, session_id: str, data: Dict[str, Any]
) -> None:
    # The Mastermind declares `depends_on` by slug (item_ids don't exist yet while it's
    # still composing the list) — resolved to real item_ids here, once, at creation time,
    # so cascading deprecation later is a lookup rather than the model reverse-engineering
    # dependencies from diffs after the fact. An unrecognized slug (hallucinated/typo'd) is
    # dropped rather than raising, since this is untrusted model output.
    slug_to_item_id = {item["slug"]: f"task{i}" for i, item in enumerate(data["tasks"], start=1)}
    resolved_tasks = [
        {
            **item,
            "depends_on": [
                slug_to_item_id[s] for s in item.get("depends_on", []) if s in slug_to_item_id
            ],
        }
        for item in data["tasks"]
    ]
    feature_dir = db.PPM_ROOT / project_id / mastermind / "features" / feature_slug
    (feature_dir / "tasks.md").write_text(render_tasks_md(resolved_tasks))
    db.insert_task_items(task_id, resolved_tasks)
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
    extra_env: Dict[str, str] = {}
    if stage == "context":
        cwd: Optional[Path] = db.PPM_ROOT / project_id
        tool_flags = ["--tools", "", "--safe-mode"]
    elif stage in ("requirements", "tasks", "consultation"):
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
        # runs: "permission_denials" in the transcript, task_item stuck in-progress).
        # acceptEdits auto-accepts Edit/Write; Bash is gated separately, per-command, by the
        # PreToolUse hook registered via --settings (confirmed live: a hook's explicit
        # allow/deny decision is honored without needing bypassPermissions at all — the hook
        # fires before the permission-mode check). Review gets neither flag — it has no write
        # tools, nothing to grant permission for.
        if "Bash" in tools_str:
            tool_flags += ["--permission-mode", "acceptEdits", "--settings", _bash_hook_settings()]
            extra_env = {"ENIAC_BACKEND_URL": ENIAC_BACKEND_URL, "ENIAC_RUN_ID": run_id, "ENIAC_TASK_ID": task_id}
        elif any(t in tools_str for t in ("Edit", "Write")):
            tool_flags += ["--permission-mode", "acceptEdits"]
    else:
        cwd = None
        tool_flags = []

    if resume_session_id is not None:
        reminder = _RESUME_REMINDERS.get(stage)
        resumed_prompt = f"{prompt}\n\n---\n\n{reminder}" if reminder else prompt
        command = ["claude", "-r", resume_session_id, "-p", resumed_prompt, "--output-format", "json", *tool_flags]
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
        env={**os.environ, **extra_env} if extra_env else None,
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

                data = _parse_assistant_json(result_text, mastermind)
                db.set_task_item_session(task_id, item_id, session_id)

                assert cwd is not None
                item_row = db.get_task_item(task_id, item_id)
                since = item_row["baseline_commit"] if item_row else None
                db.set_run_diff(run_id, working_tree_diff(cwd, since=since), summary=data.get("summary"))

                if data["status"] == "done":
                    db.set_task_item_status(task_id, item_id, "awaiting_review")
                    # An Assistant (Review, today) can propose new task items alongside its
                    # own normal done/report — independent of that report's own approval,
                    # staged the same way a Mastermind consultation's proposal is.
                    new_tasks = data.get("new_tasks")
                    if new_tasks:
                        resolved_new_tasks, _ = _resolve_slug_references(task_id, new_tasks)
                        db.set_pending_amendment(
                            task_id,
                            {
                                "kind": "proposal",
                                "source": "review",
                                "origin_item_id": item_id,
                                "resume_session_id": session_id,
                                "new_tasks": resolved_new_tasks,
                                "deprecate_item_ids": [],
                                "reasoning": data["summary"],
                            },
                        )
                else:
                    # "blocked" — the Assistant is asking for guidance, not crashing.
                    # Only this item stops; the task and its other items stay alive,
                    # resolved the same way a rejected review is (resume + feedback).
                    db.set_task_item_blocked(task_id, item_id, data["reason"])
            except Exception as exc:
                db.mark_task_failed(task_id, f"Failed to process agent response: {exc}")
        else:
            db.mark_task_failed(task_id, _process_failure_reason(process.returncode, transcript))

    elif stage == "consultation":
        if status == "completed":
            try:
                wrapper = json.loads(transcript)
                session_id = wrapper["session_id"]
                result_text = wrapper["result"]
                await queue.put(result_text)

                assert mastermind is not None
                data = _parse_consultation_json(result_text, mastermind)
                if data["status"] == "needs_clarification":
                    db.set_pending_amendment(
                        task_id,
                        {
                            "kind": "clarification",
                            "source": "mastermind",
                            "origin_item_id": None,
                            "resume_session_id": session_id,
                            "questions": data["questions"],
                        },
                    )
                else:
                    resolved_new_tasks, resolved_deprecate = _resolve_slug_references(
                        task_id, data["new_tasks"], data["deprecate_item_ids"]
                    )
                    db.set_pending_amendment(
                        task_id,
                        {
                            "kind": "proposal",
                            "source": "mastermind",
                            "origin_item_id": None,
                            "resume_session_id": session_id,
                            "new_tasks": resolved_new_tasks,
                            "deprecate_item_ids": resolved_deprecate,
                            "reasoning": data["reasoning"],
                        },
                    )
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
