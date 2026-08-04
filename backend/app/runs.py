from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

from . import db

REPO_ROOT = Path(__file__).resolve().parents[2]
SUPERVISOR_PROMPT_PATH = REPO_ROOT / "agents" / "supervisor" / "prompt.md"
DISCUSSION_PROMPT_PATH = REPO_ROOT / "agents" / "discussion" / "prompt.md"
CONTEXT_INVESTIGATOR_PROMPT_PATH = REPO_ROOT / "agents" / "context-investigator" / "prompt.md"
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
# Design/Implementation write code, Review only reads it. Analysis (DevOps) and Discovery
# (Architect) are investigation only, same read-only stance as Review. Decision and Diagram
# (Architect) write real files but never need Bash — they only ever produce ADR/diagram
# markdown, never code, config, or infra-as-code, so there's nothing to shell out to verify.
# Test, CI-CD Implementer, and Environment get real Bash — every call is gated per-command by
# a PreToolUse hook (agents/hooks/bash_gate.py, wired in below) that asks the Eniac backend for
# a decision: an instant answer if the exact
# command is already on the `bash_allowlist`, otherwise a real wait for a human to approve/
# deny/allowlist it via the UI. This replaced an earlier all-or-nothing `bypassPermissions`
# grant (tried for Test on 2026-07-24, reverted the same day — no per-command gate, an
# unbounded risk unscoped by git-diff review, unlike Edit/Write which are path-scoped and
# fully revertible) once the hook mechanism was built and verified live. See
# [[eniac-no-unattended-bash]] for that history — this supersedes it, not contradicts it.
ASSISTANT_TOOLS = {
    "Design": "Read,Grep,Glob",
    "Implementation": "Edit,Write,Read",
    "Review": "Read",
    "Test": "Edit,Write,Read,Bash",
    "Analysis": "Read,Grep,Glob",
    "CI-CD Implementer": "Edit,Write,Read,Grep,Glob,Bash",
    "Environment": "Edit,Write,Read,Grep,Glob,Bash",
    "Discovery": "Read,Grep,Glob",
    "Decision": "Edit,Write,Read,Grep,Glob",
    "Diagram": "Edit,Write,Read,Grep,Glob",
}

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
}


def _model_for_stage(stage: str, assistant: Optional[str] = None) -> str:
    """Resolves which ROLE_MODELS entry a given start_run call should use. "context" ->
    the Supervisor; "requirements"/"tasks"/"consultation" all share the single
    "mastermind" entry (see ROLE_MODELS' docstring-comment for why); "execution" is keyed
    by the assistant's own name, same granularity as ASSISTANT_TOOLS."""
    if stage in ("context", "discuss"):
        return ROLE_MODELS["supervisor"]
    if stage in ("requirements", "tasks", "consultation"):
        return ROLE_MODELS["mastermind"]
    assert stage == "execution" and assistant is not None
    return ROLE_MODELS[assistant]

# Skills only ever apply to the execution stage — read straight off disk into the prompt
# string by `_skills_block` below, not through the CLI's own skill-loading, specifically
# because --safe-mode disables skills entirely regardless of source (confirmed live: a
# --plugin-dir-loaded skill was completely invisible under --safe-mode) — and most
# execution-stage Assistants run under --safe-mode too now (see ASSISTANT_TOOLS/
# start_run), so relying on the CLI's own mechanism would've broken skills for exactly the
# roles they exist for. Keyed by
# (mastermind, assistant), not assistant name alone, since assistant names are shared
# across domains (e.g. "Implementation" exists for both frontend and backend) but the
# skills that make sense for each are not.
#
# This is a catalog (skill_name -> short one-line description), not an auto-apply list —
# which of a domain's available skills actually applies to a given task item is decided by
# the Mastermind itself, per item, when it writes tasks.md (same place it already decides
# `assistant`/`repo`/`depends_on`) — it has real investigation context a static rule or a
# separate selection step wouldn't. The description here is a short catalog blurb, not
# parsed out of the SKILL.md frontmatter (a real YAML parser is more than this needs).
# `_write_tasks` validates the Mastermind's picks against this catalog, defaulting an
# invented name to "not applied" rather than raising — the model never gets to invoke a
# skill Eniac didn't actually register.
#
# Not invoked via the CLI's own `/skill-name` mechanism: confirmed live that only the
# *first* `/skill-name` in a message is actually invoked — every subsequent one on its own
# line is read back as plain text, not a second invocation (the model's own words: "the
# second /name text was passed as an argument, not a command"). Doesn't compose. Instead,
# each selected skill's SKILL.md content is read directly and prepended as plain
# instructional text — the same proven mechanism _project_context_block already uses for
# architecture.md/conventions.md. Composes trivially for any number of skills, since it's
# just concatenating files, not chaining an undocumented CLI behavior.
_FRONTEND_CODE_WRITING = (
    "Framework-agnostic frontend craft guidance -- accessibility, component/state "
    "boundaries, styling discipline, and the loading/empty/error states real UI "
    "needs beyond the happy path."
)
_BACKEND_CODE_WRITING = (
    "Framework-agnostic backend craft guidance -- API/interface shape, error handling, "
    "data and persistence discipline, and security boundaries."
)
_CODE_REVIEW_CRAFT = (
    "What a good review actually checks, how to cite findings with real evidence, "
    "severity triage, and when a finding is worth proposing as a new task item."
)
_TEST_WRITING_CRAFT = (
    "Matching existing test conventions, testing behavior over implementation, real "
    "edge-case coverage, and confirming tests actually pass rather than assuming."
)

# One catalog entry per (mastermind, assistant) pair that has a skill today. Design has
# none -- it doesn't write code, only a design document, so the code-writing craft skill
# below doesn't apply to it. Same skill for Review and Test across backend/frontend (the
# craft of reviewing/testing well doesn't depend on which codebase it's aimed at, only the
# target does, and that's already supplied via requirements.md).
ASSISTANT_SKILLS: Dict[Tuple[str, str], Dict[str, str]] = {
    ("frontend", "Implementation"): {"frontend-code-writing": _FRONTEND_CODE_WRITING},
    ("frontend", "Review"): {"code-review-craft": _CODE_REVIEW_CRAFT},
    ("frontend", "Test"): {"test-writing-craft": _TEST_WRITING_CRAFT},
    ("backend", "Implementation"): {"backend-code-writing": _BACKEND_CODE_WRITING},
    ("backend", "Review"): {"code-review-craft": _CODE_REVIEW_CRAFT},
    ("backend", "Test"): {"test-writing-craft": _TEST_WRITING_CRAFT},
    ("devops", "Analysis"): {
        "devops-analysis-craft": (
            "What makes an infra/CI/CD finding decision-ready, prioritizing by real "
            "impact, and flagging security/credential issues even outside task scope."
        ),
    },
    ("devops", "CI-CD Implementer"): {
        "cicd-pipeline-craft": (
            "Fail-fast pipeline design, least-privilege credential scoping, idempotency, "
            "and the boundary between verifying a change and actually deploying it."
        ),
    },
    ("devops", "Environment"): {
        "environment-setup-craft": (
            "Complete and reproducible local dev setup -- env-var documentation, never "
            "leaking a real secret into a committed file, keeping docs and scripts in sync."
        ),
    },
    ("architect", "Discovery"): {
        "architecture-discovery-craft": (
            "Grounding every claim in real evidence, scoping to the task, and reporting "
            "fact -- not recommendation -- including explicitly noting what's absent."
        ),
    },
    ("architect", "Decision"): {
        "adr-writing-craft": (
            "Real alternatives (not strawmen), honest consequences (not just benefits), "
            "and writing context self-contained enough to outlive today's conversation."
        ),
    },
    ("architect", "Diagram"): {
        "diagram-clarity-craft": (
            "Choosing the right diagram type for the content, using real names grounded "
            "in the actual code, and staying scoped to what the diagram is actually for."
        ),
    },
}
SKILLS_DIR = REPO_ROOT / "agents" / "skills" / "skills"


def _strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4 :].lstrip("\n")
    return text


def _skills_block(skill_names: List[str]) -> str:
    """Pure content-reader — no catalog lookup here. The decision of which skills apply
    already happened once, at tasks.md creation time, and is stored per item; this just
    plays back whatever was decided, the same way execution already does for `repo`."""
    sections = []
    for name in skill_names:
        skill_path = SKILLS_DIR / name / "SKILL.md"
        if skill_path.is_file():
            sections.append(_strip_frontmatter(skill_path.read_text()))
    if not sections:
        return ""
    return "## Relevant Skills\n\n" + "\n\n".join(sections) + "\n\n---\n\n"

# The backend's own base URL, so the PreToolUse hook (a subprocess of `claude`, not of this
# process) knows where to POST/poll approval requests. No prior "my own base URL" concept
# existed in this codebase (port 1946 was only ever hardcoded in scripts/start.sh) — this
# introduces it minimally, overridable via env, defaulting to the documented dev port.
ENIAC_BACKEND_URL = os.environ.get("ENIAC_BACKEND_URL", "http://localhost:1946")
BASH_GATE_HOOK_PATH = REPO_ROOT / "agents" / "hooks" / "bash_gate.py"
WRITE_GATE_HOOK_PATH = REPO_ROOT / "agents" / "hooks" / "write_gate.py"


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
        'or {"status": "ready", "summary": ..., "requirements": [...], "file_plan": '
        '[{"path": ..., "action": ..., "purpose": ...}], "out_of_scope": [...], "open_risks": [...]}.'
    ),
    "tasks": (
        'Reminder: respond with only a single JSON object -- no markdown fences, no prose '
        'before or after it -- either {"status": "needs_clarification", "questions": [...]} '
        'or {"status": "ready", "tasks": [{"slug": ..., "description": ..., "assistant": ..., '
        '"depends_on": [...], "repo": ..., "skills": [...]}, ...]}. "repo" is optional -- only '
        'set it if this workspace has multiple repos and you were told which ones. "skills" is '
        "optional -- only set it to names from whatever skills list you were given for this "
        "domain, never an invented name."
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


_REPO_SCAN_SKIP = {"node_modules", ".venv", "venv", "vendor"}


def discover_repos(workspace_path: Path) -> List[str]:
    """Scans `workspace_path` for git repos, up to 2 levels deep, to detect whether it's a
    single repo or an orchestrator directory wrapping several independently-versioned child
    repos (e.g. `~/deploy/repos/<service>/.git` each) — the real shape found live in the
    `vidilaptopi` project, where every git-plumbing call in this codebase was blind to
    anything inside a child repo because it always ran `git -C workspace_path`.

    Nested child repos take priority over `workspace_path`'s own `.git`, not the other way
    around — found live: a real orchestrator directory (`vidilaptopi-deploy`) is itself
    git-tracked (Makefile, compose files) *in addition to* wrapping several independently
    versioned child repos under `repos/`, so treating "root has a `.git`" as automatically
    meaning single-repo silently ignored every child underneath it. Only falls back to
    `["."]` when no nested repos are found at all (root `.git` with no children — an
    ordinary single-repo project, unaffected by any of this) — this deliberately no longer
    tries to special-case a submodule checkout as "root wins"; a submodule's own directory
    is a perfectly real, independently git-operable child repo for Eniac's purposes too.

    Otherwise returns the sorted relative paths of every child directory (1-2 levels deep)
    that has its own `.git`, skipping common heavy/hidden directories that would slow the
    walk down for no benefit (`node_modules`, `.venv`, etc.).
    """
    found = []
    for child in sorted(workspace_path.iterdir()):
        if not child.is_dir() or child.name.startswith(".") or child.name in _REPO_SCAN_SKIP:
            continue
        if (child / ".git").exists():
            found.append(child.relative_to(workspace_path).as_posix())
            continue
        for grandchild in sorted(child.iterdir()):
            if not grandchild.is_dir() or grandchild.name.startswith(".") or grandchild.name in _REPO_SCAN_SKIP:
                continue
            if (grandchild / ".git").exists():
                found.append(grandchild.relative_to(workspace_path).as_posix())
    if found:
        return found
    if (workspace_path / ".git").exists():
        return ["."]
    return []


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
            candidate = text[start : end + 1]
            # A real JSON object always has at least one "key": value pair, so a colon is
            # a cheap, effective filter against a merely brace-balanced non-JSON substring
            # in the model's own prose — found live: a route-parameter placeholder like
            # `{store}` (Laravel-style, no colon) balances perfectly and was mistaken for
            # "the JSON reply" on a response that was actually plain, un-JSON-wrapped prose,
            # producing a baffling "line 1 column 2" error instead of a clear "no JSON found".
            if ":" in candidate:
                best = candidate
            # Resume *after* this match either way, not from inside it — a brace-like
            # substring inside this object's own string values (e.g. real content
            # describing JSX like `{storeLabel}`) must not be re-examined as its own
            # candidate.
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
        required = {"summary", "requirements", "file_plan", "out_of_scope", "open_risks"}
        missing = required - data.keys()
        if missing:
            raise ValueError(f"missing keys: {missing}")
        if not data["requirements"]:
            raise ValueError("requirements must be non-empty")
        # file_plan is what lets Implementation/Review/Test skip their own Grep/Glob
        # discovery (see ASSISTANT_TOOLS) -- it has to actually be there and each entry
        # has to be usable, not just present.
        if not data["file_plan"]:
            raise ValueError("file_plan must be non-empty")
        for entry in data["file_plan"]:
            if not {"path", "action", "purpose"} <= entry.keys():
                raise ValueError(f"invalid file_plan entry: {entry}")
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
    try:
        data = json.loads(_strip_fences(result_text))
    except json.JSONDecodeError:
        # Found live: an Assistant that correctly determined no changes were needed
        # reported that in plain prose instead of the required JSON envelope, with no
        # JSON object anywhere in the response at all -- hard-failing the whole task item
        # (forcing a retry that's liable to hit the exact same non-compliant reply again,
        # since the underlying finding is genuinely "nothing to do") throws away a
        # perfectly informative report over a formatting slip. A human reviews `summary`
        # before anything is approved either way, same as a well-formed "done" -- so
        # falling back to it here costs nothing a normal review wouldn't already catch.
        return {"status": "done", "summary": result_text.strip()}
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

    def file_plan_bullets(entries: List[Dict[str, str]]) -> str:
        return "\n".join(f"- `{e['path']}` ({e['action']}): {e['purpose']}" for e in entries)

    return f"""# Requirements

## Summary
{data['summary']}

## Requirements
{bullets(data['requirements'], "None.")}

## File Plan
{file_plan_bullets(data['file_plan'])}

## Out of Scope
{bullets(data['out_of_scope'], "None noted.")}

## Open Risks
{bullets(data['open_risks'], "None noted.")}
"""


def _resolve_item_repo(repo: Optional[str], valid_repos: set) -> str:
    """Same "untrusted output, default rather than raise" stance as depends_on/skills below:
    an item naming a repo that doesn't exist in this workspace (hallucinated/stale/omitted)
    falls back to "." when the workspace root is itself a valid git target, or else to the
    first discovered child repo — "." is never a usable fallback for an orchestrator whose
    root has no .git of its own (discover_repos only ever returns "." when there are no
    child repos to report instead), so defaulting to it there would just trade one invalid
    value for another."""
    if repo in valid_repos:
        return repo
    if "." in valid_repos:
        return "."
    return sorted(valid_repos)[0] if valid_repos else "."


def _resolve_slug_references(
    task_id: str,
    new_tasks: List[Dict[str, Any]],
    deprecate_refs: Optional[List[str]] = None,
    workspace_path: Optional[str] = None,
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

    Also resolves `repo` the same way `_write_tasks` does for the original plan — a Review
    proposal or consultation is just as capable of naming a bad/missing repo on an
    orchestrator project, and until this was added that value passed straight through to
    execution unchecked (only failing later, mid-run, once an Assistant actually tried to
    git-status an unresolvable path).
    """
    existing = db.get_task_items(task_id)
    slug_to_item_id = {item["slug"]: item["item_id"] for item in existing}
    next_n = len(existing) + 1
    for offset, item in enumerate(new_tasks):
        slug_to_item_id.setdefault(item["slug"], f"task{next_n + offset}")

    valid_repos = set(discover_repos(Path(workspace_path).expanduser())) if workspace_path else {"."}
    resolved_new_tasks = [
        {
            **item,
            "depends_on": [slug_to_item_id.get(s, s) for s in item.get("depends_on", [])],
            "repo": _resolve_item_repo(item.get("repo"), valid_repos),
        }
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
    `deprecated_reason` (an approved amendment superseded it), `depends_on` (item_ids
    it builds on), `repo` (which child repo this item targets, in a multi-repo
    workspace — omitted or "." for the ordinary single-repo case), and `skills` (which
    registered skill(s) the Mastermind decided apply to this item) — one renderer used
    both for the original write and for re-rendering an amended document, not two."""
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
        repo = item.get("repo")
        if repo and repo != ".":
            section += f"\n\n**Repo:** {repo}"
        skills = item.get("skills")
        if skills:
            section += f"\n\n**Skills:** {', '.join(skills)}"
        sections.append(section)
    return "# Tasks\n\n" + "\n\n".join(sections) + "\n"


def _write_tasks(
    project_id: str,
    task_id: str,
    mastermind: str,
    feature_slug: str,
    session_id: str,
    data: Dict[str, Any],
    workspace_path: Optional[str] = None,
) -> None:
    # The Mastermind declares `depends_on` by slug (item_ids don't exist yet while it's
    # still composing the list) — resolved to real item_ids here, once, at creation time,
    # so cascading deprecation later is a lookup rather than the model reverse-engineering
    # dependencies from diffs after the fact. An unrecognized slug (hallucinated/typo'd) is
    # dropped rather than raising, since this is untrusted model output. Numbering
    # continues from any already-existing items (a prior mastermind's own batch, in a
    # multi-mastermind task) rather than always starting at task1 — same offset
    # `_resolve_slug_references` already computes for amendments, needed here too since
    # `db.append_task_items` (not a restart-at-1 insert) is what persists these.
    existing = db.get_task_items(task_id)
    next_n = len(existing) + 1
    slug_to_item_id = {item["slug"]: f"task{next_n + i}" for i, item in enumerate(data["tasks"])}
    valid_repos = set(discover_repos(Path(workspace_path).expanduser())) if workspace_path else {"."}
    # Same stance again for `skills` — an item can only carry a skill actually registered
    # in ASSISTANT_SKILLS for (this mastermind, this item's own assistant); anything else
    # (invented, or valid for a different assistant) is dropped, not raised.
    resolved_tasks = [
        {
            **item,
            "item_id": f"task{next_n + i}",
            "depends_on": [
                slug_to_item_id[s] for s in item.get("depends_on", []) if s in slug_to_item_id
            ],
            "repo": _resolve_item_repo(item.get("repo"), valid_repos),
            "skills": [
                s
                for s in item.get("skills", [])
                if s in ASSISTANT_SKILLS.get((mastermind, item["assistant"]), {})
            ],
        }
        for i, item in enumerate(data["tasks"])
    ]
    feature_dir = db.PPM_ROOT / project_id / mastermind / "features" / feature_slug
    (feature_dir / "tasks.md").write_text(render_tasks_md(resolved_tasks))
    db.append_task_items(task_id, resolved_tasks, mastermind=mastermind)
    db.set_task_tasks_ready(task_id, session_id)


TITLE_PROMPT_TEMPLATE = (
    "Summarize the following user request as a short task title: 3-6 words, plain text, "
    "no ending punctuation, no quotation marks, no markdown. Reply with only the title.\n\n"
    "Request:\n{prompt}"
)


async def generate_title(task_id: str, project_id: str, prompt: str) -> None:
    """Fire-and-forget: a cheap haiku call producing a short sidebar label. Deliberately
    outside the start_run/stage/queue/WebSocket machinery entirely -- it has no run_id, is
    never watched live, and never touches task.status. The frontend only ever learns the
    result by polling GET /tasks (see useProjectTasks) until `title` is no longer null.

    On any failure this just returns, leaving `title` NULL forever -- no retry. The
    sidebar's existing feature_slug/prompt fallback already covers that case permanently,
    so a stuck-forever loading state is never possible.
    """
    command = [
        "claude", "-p", TITLE_PROMPT_TEMPLATE.format(prompt=prompt),
        "--output-format", "json", "--model", "haiku", "--tools", "", "--safe-mode",
    ]
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        cwd=db.PPM_ROOT / project_id,
    )
    stdout, _ = await process.communicate()
    if process.returncode != 0:
        return
    try:
        wrapper = json.loads(stdout.decode(errors="replace"))
        title = wrapper["result"].strip().strip("\"'").splitlines()[0][:80]
    except Exception:
        return
    if title:
        db.set_task_title(task_id, title)


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
    repo_scope: Optional[str] = None,
    skills: Optional[List[str]] = None,
    image_paths: Optional[List[str]] = None,
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
    # real run) without breaking normal OAuth auth, unlike --bare.
    extra_env: Dict[str, str] = {}
    if stage == "context":
        cwd: Optional[Path] = db.PPM_ROOT / project_id
        tool_flags = ["--tools", "", "--safe-mode"]
    elif stage == "discuss":
        # cwd stays a per-task sandbox outside any real repo regardless of workspace_path --
        # Write is only ever offered relative to/within reach of that sandbox in spirit, and
        # is *enforced* there by write_gate.py (a real PreToolUse hook, not just cwd
        # convention -- confirmed via live spike that a declarative --settings deny rule for
        # a path is silently ignored under acceptEdits, but a hook reliably blocks it). No
        # --safe-mode here (unlike every other stage) -- --safe-mode silently disables hooks
        # entirely, which would disable write_gate.py itself; this trades away this stage's
        # protection from the user's own global hooks/plugins/CLAUDE.md leaking in, the same
        # tradeoff already accepted for Bash-capable execution-stage Assistants below.
        cwd = db.PPM_ROOT / project_id / "discussions" / task_id
        cwd.mkdir(parents=True, exist_ok=True)
        tools = ["WebSearch", "Write"]
        add_dir_flags: List[str] = []
        if workspace_path and Path(workspace_path).expanduser().is_dir():
            # Read-only codebase access, added only when there's an actual workspace to
            # read -- a greenfield project with no workspace_path behaves exactly as before
            # (chat + search + sandboxed write, nothing to read).
            tools += ["Read", "Grep", "Glob"]
            add_dir_flags = ["--add-dir", str(Path(workspace_path).expanduser())]
        if image_paths and "Read" not in tools:
            # An attached image needs Read regardless of workspace access -- a greenfield
            # project (no workspace_path) can still have a screenshot attached to it.
            tools.append("Read")
        tool_flags = [
            "--tools", ",".join(tools),
            "--permission-mode", "acceptEdits",
            "--settings", _write_gate_settings(),
            *add_dir_flags,
        ]
        extra_env = {"ENIAC_DISCUSSION_SANDBOX": str(cwd)}
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
        else:
            # --safe-mode disables hooks outright -- confirmed live: the exact same
            # PreToolUse hook, passed via this same --settings mechanism, silently stops
            # firing under --safe-mode even though it's supplied fresh on this invocation,
            # not read from the user's own config. So this only ever applies to an
            # Assistant with no Bash (Design/Implementation/Review today) -- one with Bash
            # keeps normal hooks/plugins/CLAUDE.md active, since disabling --safe-mode's
            # hook-suppression would silently remove the per-command approval gate above,
            # not just the user's own customizations. Eniac's own skills mechanism
            # (_skills_block) is unaffected either way -- it reads SKILL.md straight off
            # disk into the prompt string in this Python process, never through the CLI's
            # own skill-loading, so --safe-mode has nothing to disable there.
            tool_flags += ["--safe-mode"]
            if any(t in tools_str for t in ("Edit", "Write")):
                tool_flags += ["--permission-mode", "acceptEdits"]
    else:
        cwd = None
        tool_flags = []

    # Only the tasks stage ever needs to know about multiple repos, and only when the
    # workspace actually has more than one — an ordinary single-repo project's tasks-stage
    # prompt stays exactly as it always has, no new text to think about.
    # Discuss mode's cwd is deliberately the sandbox dir, not the workspace (so Write's
    # gated-by-cwd-convention story stays simple) -- the workspace is only reachable via
    # --add-dir, which grants *permission* to read it but tells the model nothing about
    # *where* it is. Without this, a live check found the model correctly ran Glob, found
    # nothing (searching its own empty cwd), and concluded the codebase didn't exist.
    workspace_guidance = ""
    if stage == "discuss" and workspace_path and Path(workspace_path).expanduser().is_dir():
        workspace_guidance = (
            f"\n\nThis project's codebase is available to you, read-only, at: "
            f"{Path(workspace_path).expanduser()} — use Read/Grep/Glob there (not your own "
            "current directory) whenever a question is about the actual project."
        )

    repo_guidance = ""
    if stage == "tasks" and workspace_path:
        repos = discover_repos(Path(workspace_path).expanduser())
        if repos and repos != ["."]:
            repo_list = ", ".join(f"`{r}`" for r in repos)
            repo_guidance = (
                f"\n\nThis workspace's root is not itself a task target — the real repo(s) "
                f'live under it: {repo_list}. Every task item\'s "repo" field is required — '
                f'set it to exactly one of these paths (e.g. "repo": "repos/audit-service"). '
                'There is no workspace-root fallback.'
            )

    # Same idea, for whichever skills are actually registered for this domain — a Mastermind
    # with nothing in the catalog (every domain but Frontend today) gets a byte-for-byte
    # unchanged prompt, same as repo_guidance's no-op case above.
    skills_guidance = ""
    if stage == "tasks" and mastermind:
        catalog_lines = [
            f'- For **{a}**: `{name}` — {desc}'
            for (m, a), skills_for_pair in ASSISTANT_SKILLS.items()
            if m == mastermind
            for name, desc in skills_for_pair.items()
        ]
        if catalog_lines:
            skills_guidance = (
                "\n\nThe following skills are available for specific Assistants in this "
                'domain. For any task item you assign to one of these Assistants, add an '
                'optional "skills" field (array of skill names) naming whichever of that '
                "Assistant's available skills genuinely apply to this specific item — omit "
                "it, or leave it empty, if none do. Never name a skill not listed here:\n"
                + "\n".join(catalog_lines)
            )

    model_flags = ["--model", _model_for_stage(stage, assistant)]

    # "requirements" only ever gets image_paths on its fresh call in practice (nothing on
    # the resume path passes them), so this being computed once here rather than only in
    # the fresh branch below is a no-op widening for that stage -- unlike "discuss", whose
    # follow-ups are genuinely new turns that might each bring a different image, so this
    # has to be available to both the fresh and resumed paths.
    images_block = ""
    image_dir_flags: List[str] = []
    if stage in ("requirements", "discuss") and image_paths:
        image_list = "\n".join(f"- `{p}`" for p in image_paths)
        images_block = (
            "\n\nThe user attached the following image file(s) with this message. Use "
            f"the Read tool to view any that are relevant:\n{image_list}"
        )
        # Read being in --tools isn't enough on its own for a path outside this stage's own
        # cwd -- found live: the attachments dir lives under PPM_ROOT, so a Read call
        # against it was denied even with Read granted, same class of non-interactive-mode
        # gap as Edit/Write needing acceptEdits above, just for out-of-cwd reads
        # specifically. --add-dir grants exactly those directories without loosening
        # anything else.
        image_dirs = sorted({str(Path(p).parent) for p in image_paths})
        for d in image_dirs:
            image_dir_flags += ["--add-dir", d]

    if resume_session_id is not None:
        reminder = _RESUME_REMINDERS.get(stage)
        suffix = f"{repo_guidance}{skills_guidance}{images_block}"
        resumed_prompt = f"{prompt}\n\n---\n\n{reminder}{suffix}" if reminder else f"{prompt}{suffix}"
        command = [
            "claude", "-r", resume_session_id, "-p", resumed_prompt,
            "--output-format", "json", *tool_flags, *model_flags, *image_dir_flags,
        ]
    else:
        if stage == "context":
            stage_prompt = SUPERVISOR_PROMPT_PATH.read_text()
        elif stage == "discuss":
            stage_prompt = DISCUSSION_PROMPT_PATH.read_text()
        elif stage == "execution":
            assert mastermind is not None and assistant is not None
            stage_prompt = assistant_prompt_path(mastermind, assistant).read_text()
        else:
            assert mastermind is not None
            stage_prompt = mastermind_prompt_path(mastermind).read_text()
        label = "User request" if stage in ("context", "discuss") else "Input"
        # A prior project-context refresh's architecture.md/conventions.md, if any —
        # silent no-op for a project that's never run one. Only ever populated on this
        # fresh-call path: "tasks"/"consultation" always resume the "requirements"
        # session in practice, and a reject/retry always resumes its own item's prior
        # execution session (see main.py's call sites), so injecting once here reaches
        # every one of these stages for free via that session's own continuity — the
        # Assistants under "execution" get it exactly the same way the Masterminds do,
        # just scoped by `repo_scope` being the task *item's* own repo (passed by the
        # caller) rather than the task's.
        if stage in ("requirements", "tasks", "consultation", "execution"):
            context_block = _project_context_block(project_id, repo_scope, mastermind)
        elif stage == "discuss":
            context_block = _discussion_context_block(project_id, repo_scope)
        else:
            context_block = ""
        # Only fires on this same fresh-call path as context_block, for the same reason:
        # a reject/retry resumes the item's own prior session, which already saw this.
        skill_block = _skills_block(skills or []) if stage == "execution" else ""
        combined_prompt = (
            f"{skill_block}{context_block}{stage_prompt}\n\n---\n\n{label}:\n{prompt}"
            f"{repo_guidance}{skills_guidance}{images_block}{workspace_guidance}"
        )
        command = [
            "claude", "-p", combined_prompt, "--output-format", "json",
            *tool_flags, *model_flags, *image_dir_flags,
        ]

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

    if stage == "discuss":
        if status == "completed":
            try:
                wrapper = json.loads(transcript)
                session_id = wrapper["session_id"]
                result_text = wrapper["result"]
                await queue.put(result_text)

                # Plain prose, not JSON — the one stage in this system with no structured
                # handoff to validate. The reply is the deliverable, shown to the user as-is.
                db.set_task_awaiting_reply(task_id, session_id)
            except Exception as exc:
                db.mark_task_failed(task_id, f"Failed to process agent response: {exc}")
        else:
            db.mark_task_failed(task_id, _process_failure_reason(process.returncode, transcript))

    elif stage == "context":
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
                        project_id, task_id, mastermind, task["feature_slug"], session_id, data,
                        workspace_path=workspace_path,
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
                    # Design has no Edit/Write tools -- its `summary` *is* its deliverable,
                    # not just a report about one -- so it's also persisted as design.md,
                    # same PPM feature-directory convention as _write_requirements/
                    # _write_tasks, for Implementation's execution_prompt to fold in later.
                    if assistant == "Design":
                        task_row = db.get_task(task_id)
                        feature_dir = (
                            db.PPM_ROOT / project_id / mastermind / "features" / task_row["feature_slug"]
                        )
                        feature_dir.mkdir(parents=True, exist_ok=True)
                        (feature_dir / "design.md").write_text(data["summary"])
                    # An Assistant (Review, today) can propose new task items alongside its
                    # own normal done/report — independent of that report's own approval,
                    # staged the same way a Mastermind consultation's proposal is.
                    new_tasks = data.get("new_tasks")
                    if new_tasks:
                        resolved_new_tasks, _ = _resolve_slug_references(
                            task_id, new_tasks, workspace_path=workspace_path
                        )
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
                        task_id, data["new_tasks"], data["deprecate_item_ids"], workspace_path=workspace_path
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


# --- Project context refresh ---
# One-time-per-project (not per-feature) investigation producing architecture.md/
# conventions.md reference material every Mastermind's own investigation can draw on
# instead of re-deriving the same basics every task. Not tied to any task — reuses the
# run-streaming queue (register_run/_queues/stream_run above) without a `runs` table
# row, since nothing here needs replay/diff/task-linkage the way a task-scoped run does.


def _project_context_block(project_id: str, repo_scope: Optional[str], mastermind: str) -> str:
    """Whatever architecture.md/conventions.md a prior context refresh produced for this
    scope (workspace root, or a child repo — a node-scoped task's own repo for a
    Mastermind call, or a task item's own repo for an Assistant/execution call),
    formatted as extra context to prepend to the prompt. Empty string — a true no-op,
    not even an empty heading — when nothing's been generated yet."""
    if repo_scope and repo_scope != ".":
        target_dir = db.PPM_ROOT / project_id / "repos" / repo_scope
    else:
        target_dir = db.PPM_ROOT / project_id

    sections = []
    architecture_path = target_dir / "architecture.md"
    if architecture_path.is_file() and architecture_path.stat().st_size > 0:
        sections.append(architecture_path.read_text())
    conventions_path = target_dir / mastermind / "conventions.md"
    if conventions_path.is_file() and conventions_path.stat().st_size > 0:
        sections.append(conventions_path.read_text())
    if not sections:
        return ""
    return "## Known Project Context\n\n" + "\n\n".join(sections) + "\n\n---\n\n"


def _discussion_context_block(project_id: str, repo_scope: Optional[str]) -> str:
    """Same idea and target_dir resolution as `_project_context_block`, for Discuss mode's
    fresh (first) call -- but Discuss mode has no single mastermind to scope by, so this
    pulls in architecture.md plus every domain's conventions.md that actually exists,
    instead of just one. Empty string when nothing's been generated yet, same as the
    mastermind-scoped version."""
    if repo_scope and repo_scope != ".":
        target_dir = db.PPM_ROOT / project_id / "repos" / repo_scope
    else:
        target_dir = db.PPM_ROOT / project_id

    sections = []
    architecture_path = target_dir / "architecture.md"
    if architecture_path.is_file() and architecture_path.stat().st_size > 0:
        sections.append(architecture_path.read_text())
    for mastermind in sorted(KNOWN_MASTERMINDS):
        conventions_path = target_dir / mastermind / "conventions.md"
        if conventions_path.is_file() and conventions_path.stat().st_size > 0:
            sections.append(conventions_path.read_text())
    if not sections:
        return ""
    return "## Known Project Context\n\n" + "\n\n".join(sections) + "\n\n---\n\n"


def _parse_context_investigator_json(result_text: str) -> Dict[str, Any]:
    data = json.loads(_strip_fences(result_text))
    if data.get("status") != "done":
        raise ValueError(f"unknown status: {data.get('status')!r}")
    required = {"layout", "dependencies", "conventions"}
    missing = required - data.keys()
    if missing:
        raise ValueError(f"missing keys: {missing}")
    return data


def _render_architecture_md(data: Dict[str, Any]) -> str:
    modules = data["layout"].get("modules") or []
    module_lines = "\n".join(f"- `{m['path']}` — {m['description']}" for m in modules) or "None identified."

    deps = data.get("dependencies") or []
    dep_lines = []
    for d in deps:
        version = f" ({d['version']})" if d.get("version") else ""
        dep_lines.append(f"- `{d['name']}`{version} — {d['kind']}, {d['ecosystem']}")
    dep_text = "\n".join(dep_lines) or "None identified."

    notes = data.get("notes") or []
    note_lines = "\n".join(f"- {n}" for n in notes) or "None."

    return f"""# Architecture

## Layout
{data['layout']['summary']}

### Modules
{module_lines}

## Dependencies
{dep_text}

## Notes
{note_lines}
"""


def _render_conventions_md(domain: str, conventions_text: str) -> str:
    return f"# {domain.capitalize()} Conventions\n\n{conventions_text}\n"


def _write_context_files(target_dir: Path, data: Dict[str, Any]) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "architecture.md").write_text(_render_architecture_md(data))
    (target_dir / "architecture.json").write_text(json.dumps(data, indent=2))
    for domain, text in data["conventions"].items():
        if domain not in KNOWN_MASTERMINDS or not text:
            continue
        domain_dir = target_dir / domain
        domain_dir.mkdir(parents=True, exist_ok=True)
        (domain_dir / "conventions.md").write_text(_render_conventions_md(domain, text))


async def _run_claude_once(prompt: str, cwd: Path, tool_flags: List[str]) -> "tuple[Optional[int], str]":
    """Spawns `claude -p <prompt> --output-format json <tool_flags>`, waits for exit,
    returns (returncode, combined stdout+stderr transcript). Same isolation stance as
    every other investigation stage in `start_run` — read-only tools, --safe-mode."""
    command = ["claude", "-p", prompt, "--output-format", "json", *tool_flags]
    process = await asyncio.create_subprocess_exec(
        *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, cwd=cwd
    )
    transcript_lines = []
    assert process.stdout is not None
    async for line in process.stdout:
        transcript_lines.append(line.decode(errors="replace"))
    await process.wait()
    return process.returncode, "".join(transcript_lines)


async def start_context_refresh(run_id: str, project_id: str, workspace_path: str) -> None:
    """Investigates the real codebase once at the workspace root (aware of any child
    repos) and once per discovered child repo (`discover_repos`, same detection already
    used for multi-repo tasks), writing architecture.md/architecture.json and per-domain
    conventions.md into the project's PPM directory. One target failing doesn't abort the
    others; `projects.context_refreshed_at` is set if at least one target succeeded.
    """
    queue = _queues.setdefault(run_id, asyncio.Queue())
    base = Path(workspace_path).expanduser()
    repos = discover_repos(base)
    is_orchestrator = repos not in ([], ["."])

    base_prompt = CONTEXT_INVESTIGATOR_PROMPT_PATH.read_text()
    root_prompt = base_prompt
    if is_orchestrator:
        repo_list = ", ".join(f"`{r}`" for r in repos)
        root_prompt += (
            f"\n\n---\n\nThis is the orchestrator root of a multi-repo workspace containing: "
            f"{repo_list}. Describe the overall layout and how these repos relate to each "
            "other — each child repo is investigated separately, so you don't need to go "
            "deep inside any of them."
        )

    targets = [("workspace root", base, db.PPM_ROOT / project_id, root_prompt)]
    if is_orchestrator:
        for repo in repos:
            targets.append((repo, base / repo, db.PPM_ROOT / project_id / "repos" / repo, base_prompt))

    succeeded = False
    errors: List[str] = []
    for label, cwd, target_dir, prompt_text in targets:
        await queue.put(f"Investigating {label}…\n")
        returncode, transcript = await _run_claude_once(
            prompt_text,
            cwd,
            ["--tools", "Read,Grep,Glob", "--safe-mode", "--model", ROLE_MODELS["context_investigator"]],
        )
        if returncode != 0:
            errors.append(f"{label}: {_process_failure_reason(returncode, transcript)}")
            continue
        try:
            wrapper = json.loads(transcript)
            data = _parse_context_investigator_json(wrapper["result"])
            _write_context_files(target_dir, data)
            succeeded = True
            await queue.put(f"{label}: done.\n")
        except Exception as exc:
            errors.append(f"{label}: failed to process agent response: {exc}")

    if succeeded:
        db.set_project_context_refreshed(project_id)
    if errors:
        await queue.put("Some targets failed:\n" + "\n".join(f"- {e}" for e in errors) + "\n")
    await queue.put(_DONE)  # type: ignore[arg-type]
