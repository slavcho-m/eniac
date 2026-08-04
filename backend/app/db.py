from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

ENIAC_HOME = Path.home() / ".eniac"
DB_PATH = ENIAC_HOME / "state.db"
PPM_ROOT = ENIAC_HOME / "ppm"

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_path TEXT,
    description TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    feature_slug TEXT,
    masterminds TEXT,
    mastermind_index INTEGER,
    mastermind_history TEXT,
    context_confirmed_at TEXT,
    session_id TEXT,
    pending_questions TEXT,
    requirements_approved_at TEXT,
    tasks_approved_at TEXT,
    error TEXT,
    pending_amendment TEXT,
    repo_scope TEXT,
    image_paths TEXT,
    mode TEXT NOT NULL DEFAULT 'ship',
    title TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    stage TEXT NOT NULL,
    item_id TEXT,
    status TEXT NOT NULL,
    transcript TEXT,
    diff TEXT,
    replay_params TEXT,
    summary TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS task_items (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    item_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL,
    assistant TEXT NOT NULL,
    status TEXT NOT NULL,
    session_id TEXT,
    baseline_commit TEXT,
    blocked_reason TEXT,
    deprecated_reason TEXT,
    depends_on TEXT,
    sort_order INTEGER,
    repo TEXT,
    skills TEXT,
    mastermind TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, item_id)
);
CREATE TABLE IF NOT EXISTS bash_allowlist (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    created_at TEXT NOT NULL
);
-- A single sentinel row marks "the default allowlist has been seeded" — deliberately not
-- just "is bash_allowlist empty", since a user emptying it on purpose (wants zero
-- auto-approvals for a while) shouldn't have it silently repopulated on the next restart.
CREATE TABLE IF NOT EXISTS bash_allowlist_seeded (
    id INTEGER PRIMARY KEY CHECK (id = 1)
);
CREATE TABLE IF NOT EXISTS bash_approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES runs(id),
    task_id TEXT REFERENCES tasks(id),
    command TEXT NOT NULL,
    cwd TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    feedback TEXT
);
"""

# Seeded once (see bash_allowlist_seeded) into a fresh — or pre-existing, upgrading — DB.
# Deliberately specific subcommands/scripts, not bare tool names: "git" or "npm" alone
# would also match their destructive subcommands ("git push --force", "npm publish") under
# _command_allowlisted's whole-word-prefix matching, so every entry here is scoped to a
# genuinely read-only or idempotent invocation. Common across the ecosystems this project
# and its Assistants actually touch (Python/Node/Go/Rust/Java) — not exhaustive, just the
# commands a human would rubber-stamp instantly every time anyway.
DEFAULT_BASH_ALLOWLIST = [
    "pwd",
    "ls",
    "cat",
    "find",
    "grep",
    "head",
    "tail",
    "wc",
    "git status",
    "git diff",
    "git log",
    "git show",
    "git branch",
    "pytest",
    "python -m pytest",
    "python3 -m pytest",
    "npm test",
    "npm run test",
    "npm run lint",
    "npm run typecheck",
    "npm run build",
    "go test",
    "cargo test",
    "mvn test",
    "./mvnw test",
    "./gradlew test",
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    ENIAC_HOME.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        # ponytail: no migration framework (v1 decision, see ARCHITECTURE.md §5) —
        # existing dev DBs predating these columns get them added here; a fresh
        # DB already has them from CREATE TABLE above, so "duplicate column" is expected.
        for column in ("description TEXT", "context_refreshed_at TEXT"):
            try:
                conn.execute(f"ALTER TABLE projects ADD COLUMN {column}")
            except sqlite3.OperationalError:
                pass
        for column in (
            "feature_slug TEXT",
            "masterminds TEXT",
            "mastermind_index INTEGER",
            "mastermind_history TEXT",
            "context_confirmed_at TEXT",
            "session_id TEXT",
            "pending_questions TEXT",
            "requirements_approved_at TEXT",
            "tasks_approved_at TEXT",
            "error TEXT",
            "pending_amendment TEXT",
            "repo_scope TEXT",
            "image_paths TEXT",
            "mode TEXT NOT NULL DEFAULT 'ship'",
            "title TEXT",
        ):
            try:
                conn.execute(f"ALTER TABLE tasks ADD COLUMN {column}")
            except sqlite3.OperationalError:
                pass
        for column in ("item_id TEXT", "diff TEXT", "replay_params TEXT", "summary TEXT"):
            try:
                conn.execute(f"ALTER TABLE runs ADD COLUMN {column}")
            except sqlite3.OperationalError:
                pass
        for column in (
            "session_id TEXT",
            "baseline_commit TEXT",
            "blocked_reason TEXT",
            "deprecated_reason TEXT",
            "depends_on TEXT",
            "sort_order INTEGER",
            "repo TEXT",
            "skills TEXT",
            "mastermind TEXT",
        ):
            try:
                conn.execute(f"ALTER TABLE task_items ADD COLUMN {column}")
            except sqlite3.OperationalError:
                pass
        # Backfill for rows that predate sort_order — item_id's own numeric suffix is the
        # only prior ordering signal, and it's what sort_order continues from going forward.
        conn.execute(
            "UPDATE task_items SET sort_order = CAST(SUBSTR(item_id, 5) AS INTEGER) "
            "WHERE sort_order IS NULL"
        )
        # "." (the task's own effective workspace_path, unchanged) for every row that
        # predates per-item repo scoping — matches the same default new rows get.
        conn.execute("UPDATE task_items SET repo = '.' WHERE repo IS NULL")
        for column in ("feedback TEXT",):
            try:
                conn.execute(f"ALTER TABLE bash_approvals ADD COLUMN {column}")
            except sqlite3.OperationalError:
                pass

        if conn.execute("SELECT 1 FROM bash_allowlist_seeded").fetchone() is None:
            for pattern in DEFAULT_BASH_ALLOWLIST:
                conn.execute(
                    "INSERT INTO bash_allowlist (id, pattern, created_at) VALUES (?, ?, ?)",
                    (uuid.uuid4().hex, pattern, now()),
                )
            conn.execute("INSERT INTO bash_allowlist_seeded (id) VALUES (1)")


def insert_project(name: str, workspace_path: Optional[str], description: Optional[str] = None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO projects (id, workspace_path, description, created_at) VALUES (?, ?, ?, ?)",
            (name, workspace_path, description, now()),
        )


def get_project(project_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()


def list_projects() -> List[sqlite3.Row]:
    with connect() as conn:
        return conn.execute("SELECT * FROM projects ORDER BY created_at").fetchall()


def update_project_workspace_path(project_id: str, workspace_path: Optional[str]) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE projects SET workspace_path = ? WHERE id = ?", (workspace_path, project_id)
        )


def set_project_context_refreshed(project_id: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE projects SET context_refreshed_at = ? WHERE id = ?", (now(), project_id)
        )


def count_tasks_completed_since(project_id: str, since: Optional[str]) -> int:
    with connect() as conn:
        if since is None:
            return conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'completed'", (project_id,)
            ).fetchone()[0]
        return conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'completed' AND created_at > ?",
            (project_id, since),
        ).fetchone()[0]


def delete_project(project_id: str) -> None:
    with connect() as conn:
        task_ids = [
            row["id"]
            for row in conn.execute("SELECT id FROM tasks WHERE project_id = ?", (project_id,)).fetchall()
        ]
        for task_id in task_ids:
            conn.execute("DELETE FROM task_items WHERE task_id = ?", (task_id,))
            conn.execute("DELETE FROM runs WHERE task_id = ?", (task_id,))
        conn.execute("DELETE FROM tasks WHERE project_id = ?", (project_id,))
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))


def insert_task(
    task_id: str,
    project_id: str,
    prompt: str,
    repo_scope: Optional[str] = None,
    image_paths: Optional[str] = None,
    mode: str = "ship",
) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO tasks (id, project_id, prompt, status, repo_scope, image_paths, mode, created_at) "
            "VALUES (?, ?, ?, 'running', ?, ?, ?, ?)",
            (task_id, project_id, prompt, repo_scope, image_paths, mode, now()),
        )


def get_task(task_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()


def list_tasks_for_project(project_id: str) -> List[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at", (project_id,)
        ).fetchall()


def delete_task(task_id: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM task_items WHERE task_id = ?", (task_id,))
        conn.execute("DELETE FROM runs WHERE task_id = ?", (task_id,))
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))


def set_task_context(
    task_id: str, feature_slug: str, masterminds_json: str, session_id: str
) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET status = 'context_ready', feature_slug = ?, masterminds = ?, "
            "session_id = ?, pending_questions = NULL WHERE id = ?",
            (feature_slug, masterminds_json, session_id, task_id),
        )


def set_task_awaiting_clarification(
    task_id: str, session_id: str, questions_json: str, status: str = "awaiting_clarification"
) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET status = ?, session_id = ?, pending_questions = ? WHERE id = ?",
            (status, session_id, questions_json, task_id),
        )


def set_task_title(task_id: str, title: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE tasks SET title = ? WHERE id = ?", (title, task_id))


def set_task_awaiting_reply(task_id: str, session_id: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET status = 'awaiting_reply', session_id = ? WHERE id = ?",
            (session_id, task_id),
        )


def set_task_running(task_id: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE tasks SET status = 'running' WHERE id = ?", (task_id,))


def set_task_investigating(task_id: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE tasks SET status = 'investigating' WHERE id = ?", (task_id,))


def set_task_requirements_ready(task_id: str, session_id: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET status = 'requirements_ready', session_id = ?, "
            "pending_questions = NULL WHERE id = ?",
            (session_id, task_id),
        )


def advance_task_mastermind(task_id: str, next_index: int, history_entry: Dict[str, Any]) -> None:
    """Moves a multi-mastermind task on to its next mastermind once the current one's task
    items are all done — called instead of mark_task_completed whenever
    `next_index < len(masterminds)`. Appends `history_entry` (the outgoing mastermind's own
    requirements/tasks approval timestamps, plus a completed_at) to `mastermind_history` so
    that record isn't lost when the per-cycle approval columns below get reset for the next
    mastermind. Resets `session_id`/`pending_questions` the same way every other stage
    transition already does, plus `requirements_approved_at`/`tasks_approved_at` since the
    next mastermind's requirements/tasks are a fresh, separate approval — `context_confirmed_at`
    is deliberately left alone, since confirming context is a one-time gate on the
    Supervisor's overall plan, not something each mastermind re-earns."""
    with connect() as conn:
        row = conn.execute(
            "SELECT mastermind_history FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        history = json.loads(row["mastermind_history"]) if row and row["mastermind_history"] else []
        history.append(history_entry)
        conn.execute(
            "UPDATE tasks SET status = 'investigating', mastermind_index = ?, "
            "mastermind_history = ?, requirements_approved_at = NULL, tasks_approved_at = NULL, "
            "session_id = NULL, pending_questions = NULL WHERE id = ?",
            (next_index, json.dumps(history), task_id),
        )


def set_task_planning(task_id: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE tasks SET status = 'planning_tasks' WHERE id = ?", (task_id,))


def set_task_tasks_ready(task_id: str, session_id: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET status = 'tasks_ready', session_id = ?, "
            "pending_questions = NULL WHERE id = ?",
            (session_id, task_id),
        )


def mark_task_failed(task_id: str, reason: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET status = 'failed', error = ? WHERE id = ?", (reason, task_id)
        )


def clear_task_failure(task_id: str, status: str) -> None:
    """Un-fails a task, restoring it to the in-flight status its stage was in — used by
    /tasks/{id}/retry to put the task back where it was right before the failed run."""
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET status = ?, error = NULL WHERE id = ?", (status, task_id)
        )


def confirm_task_context(task_id: str) -> str:
    confirmed_at = now()
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET context_confirmed_at = ? WHERE id = ?", (confirmed_at, task_id)
        )
    return confirmed_at


def approve_task_requirements(task_id: str) -> str:
    approved_at = now()
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET requirements_approved_at = ? WHERE id = ?", (approved_at, task_id)
        )
    return approved_at


def approve_task_tasks(task_id: str) -> str:
    approved_at = now()
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET tasks_approved_at = ? WHERE id = ?", (approved_at, task_id)
        )
    return approved_at


def set_pending_amendment(task_id: str, amendment: Dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET pending_amendment = ? WHERE id = ?", (json.dumps(amendment), task_id)
        )


def get_pending_amendment(task_id: str) -> Optional[Dict[str, Any]]:
    with connect() as conn:
        row = conn.execute("SELECT pending_amendment FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if row is None or row["pending_amendment"] is None:
        return None
    return json.loads(row["pending_amendment"])


def clear_pending_amendment(task_id: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE tasks SET pending_amendment = NULL WHERE id = ?", (task_id,))


def append_task_items(
    task_id: str,
    items: List[Dict[str, Any]],
    after_item_id: Optional[str] = None,
    mastermind: Optional[str] = None,
) -> List[str]:
    """Adds new task items to an already-approved task list — e.g. an original tasks.md
    plan, an approved amendment, or the next mastermind's own plan in a multi-mastermind
    task — continuing item_id numbering rather than restarting at task1 (item_id is a
    stable identity, referenced by depends_on/deprecate_item_ids/diffs, so it never moves;
    a second mastermind's own `task1` would otherwise collide with the first mastermind's).
    Execution/display order is tracked separately via sort_order: with `after_item_id`
    (e.g. the Review item that proposed these), the new items are slotted in right after
    it — a Review-proposed fix should run before whatever was already queued behind the
    reviewed item, not after it just because its item_id is higher. Without it (a fresh
    plan, a Mastermind consultation, or the next mastermind's own items), new items still
    land at the tail. Returns the new item_ids in order."""
    with connect() as conn:
        row = conn.execute(
            "SELECT item_id FROM task_items WHERE task_id = ? ORDER BY "
            "CAST(SUBSTR(item_id, 5) AS INTEGER) DESC LIMIT 1",
            (task_id,),
        ).fetchone()
        next_n = int(row["item_id"][4:]) + 1 if row else 1

        anchor_row = None
        if after_item_id:
            anchor_row = conn.execute(
                "SELECT sort_order FROM task_items WHERE task_id = ? AND item_id = ?",
                (task_id, after_item_id),
            ).fetchone()
        if anchor_row is not None:
            anchor = anchor_row["sort_order"]
        else:
            tail_row = conn.execute(
                "SELECT MAX(sort_order) AS max_sort_order FROM task_items WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            anchor = tail_row["max_sort_order"] or 0

        conn.execute(
            "UPDATE task_items SET sort_order = sort_order + ? WHERE task_id = ? AND sort_order > ?",
            (len(items), task_id, anchor),
        )

        new_item_ids = []
        for i, item in enumerate(items):
            item_id = f"task{next_n + i}"
            new_item_ids.append(item_id)
            conn.execute(
                "INSERT INTO task_items (task_id, item_id, slug, description, assistant, status, depends_on, sort_order, repo, skills, mastermind, created_at) "
                "VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)",
                (
                    task_id,
                    item_id,
                    item["slug"],
                    item["description"],
                    item["assistant"],
                    json.dumps(item.get("depends_on", [])),
                    anchor + i + 1,
                    item.get("repo") or ".",
                    json.dumps(item.get("skills", [])),
                    mastermind,
                    now(),
                ),
            )
    return new_item_ids


def delete_task_items(task_id: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM task_items WHERE task_id = ?", (task_id,))


def get_task_items(task_id: str) -> List[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM task_items WHERE task_id = ? ORDER BY sort_order", (task_id,)
        ).fetchall()


def get_task_item(task_id: str, item_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM task_items WHERE task_id = ? AND item_id = ?", (task_id, item_id)
        ).fetchone()


def get_next_pending_item(task_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM task_items WHERE task_id = ? AND status = 'pending' ORDER BY sort_order LIMIT 1",
            (task_id,),
        ).fetchone()


def get_awaiting_review_item(task_id: str) -> Optional[sqlite3.Row]:
    """The item currently needing a human decision — either a finished diff to review, or
    an Assistant-reported block needing guidance. Both resolve via the same approve/reject
    flow (review-artifact)."""
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM task_items WHERE task_id = ? AND status IN ('awaiting_review', 'blocked') LIMIT 1",
            (task_id,),
        ).fetchone()


def any_task_item_started(task_id: str) -> bool:
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM task_items WHERE task_id = ? AND status != 'pending'", (task_id,)
        ).fetchone()
    return row["c"] > 0


def any_task_item_started_for_repo(task_id: str, repo: str) -> bool:
    """Same as `any_task_item_started`, but scoped to one repo — for a multi-repo
    orchestrator-root task, "has this task already started" is the wrong question for the
    clean-tree guard; "has this task already started work in *this specific* repo" is the
    right one. A task whose first two items target repos/a can't use that to skip the
    clean-tree check when a third item is the task's first-ever touch of repos/b. For an
    ordinary single-repo task (every item's repo == ".") this is equivalent to the
    unscoped check, since there's only ever one repo in play."""
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM task_items WHERE task_id = ? AND repo = ? AND status != 'pending'",
            (task_id, repo),
        ).fetchone()
    return row["c"] > 0


def all_task_items_done(task_id: str) -> bool:
    """Deprecated items are excluded — they're intentionally superseded, not owed a 'done'
    status of their own, so they must not block the task from ever completing."""
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM task_items WHERE task_id = ? AND status NOT IN ('done', 'deprecated')",
            (task_id,),
        ).fetchone()
    return row["c"] == 0


def set_task_item_assistant(task_id: str, item_id: str, assistant: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE task_items SET assistant = ? WHERE task_id = ? AND item_id = ?",
            (assistant, task_id, item_id),
        )


def set_task_item_status(task_id: str, item_id: str, status: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE task_items SET status = ?, blocked_reason = NULL WHERE task_id = ? AND item_id = ?",
            (status, task_id, item_id),
        )


def set_task_item_blocked(task_id: str, item_id: str, reason: str) -> None:
    """An Assistant reported it can't self-resolve — not a crash, so the item (and the
    task) stay alive; resolved the same way a rejected review is: resume with feedback."""
    with connect() as conn:
        conn.execute(
            "UPDATE task_items SET status = 'blocked', blocked_reason = ? WHERE task_id = ? AND item_id = ?",
            (reason, task_id, item_id),
        )


def set_task_item_deprecated(task_id: str, item_id: str, reason: str) -> None:
    """An approved amendment superseded this already-run item — flagged only, its diff is
    never reverted (this project's standing rule: never auto-revert, never destructive)."""
    with connect() as conn:
        conn.execute(
            "UPDATE task_items SET status = 'deprecated', deprecated_reason = ? WHERE task_id = ? AND item_id = ?",
            (reason, task_id, item_id),
        )


def set_task_item_session(task_id: str, item_id: str, session_id: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE task_items SET session_id = ? WHERE task_id = ? AND item_id = ?",
            (session_id, task_id, item_id),
        )


def set_task_item_baseline(task_id: str, item_id: str, baseline_commit: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE task_items SET baseline_commit = ? WHERE task_id = ? AND item_id = ?",
            (baseline_commit, task_id, item_id),
        )


def get_task_baseline_commit(task_id: str) -> Optional[str]:
    """The checkpoint taken right before the task's first item ever ran — since that
    checkpoint's tree equals HEAD's tree (the clean-tree guard in approve_assistant
    guarantees this), it doubles as the anchor for a whole-task combined diff.

    Only meaningful when the whole task lives in one repo (the ordinary case, and every
    node-scoped task too — see get_task_baseline_commits_by_repo for the orchestrator-root
    case where different items can target different repos)."""
    with connect() as conn:
        row = conn.execute(
            "SELECT baseline_commit FROM task_items WHERE task_id = ? AND baseline_commit IS NOT NULL "
            "ORDER BY sort_order LIMIT 1",
            (task_id,),
        ).fetchone()
    return row["baseline_commit"] if row else None


def get_task_baseline_commits_by_repo(task_id: str) -> Dict[str, str]:
    """One baseline anchor per distinct repo the task has actually touched, each taken from
    that repo's own first-started item — for an orchestrator-root task whose items span
    multiple repos, there's no single coherent "whole task diff" the way a single-repo task
    has one; each repo needs its own anchor. For an ordinary single-repo or node-scoped task
    (every item's repo == ".") this returns exactly one entry, equivalent to
    get_task_baseline_commit."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT repo, baseline_commit FROM task_items WHERE task_id = ? AND baseline_commit IS NOT NULL "
            "ORDER BY sort_order",
            (task_id,),
        ).fetchall()
    result: Dict[str, str] = {}
    for row in rows:
        result.setdefault(row["repo"] or ".", row["baseline_commit"])
    return result


def mark_task_completed(task_id: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE tasks SET status = 'completed' WHERE id = ?", (task_id,))


def reopen_task_for_execution(task_id: str) -> None:
    """An approved amendment added real pending work to a task already sitting at
    'completed' — routes back through ExecutionView instead of staying stuck on the
    now-stale TerminalStateView. A no-op in effect if the task was already 'tasks_ready'."""
    with connect() as conn:
        conn.execute("UPDATE tasks SET status = 'tasks_ready' WHERE id = ?", (task_id,))


def insert_run(run_id: str, task_id: str, stage: str, item_id: Optional[str] = None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO runs (id, task_id, stage, item_id, status, created_at) "
            "VALUES (?, ?, ?, ?, 'running', ?)",
            (run_id, task_id, stage, item_id, now()),
        )


def complete_run(run_id: str, status: str, transcript: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE runs SET status = ?, transcript = ?, completed_at = ? WHERE id = ?",
            (status, transcript, now(), run_id),
        )


def set_run_diff(run_id: str, diff: str, summary: Optional[str] = None) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE runs SET diff = ?, summary = ? WHERE id = ?", (diff, summary, run_id)
        )


def set_run_replay_params(run_id: str, replay_params_json: str) -> None:
    """Stores exactly the kwargs `start_run` was invoked with, so a failed run can be
    replayed verbatim by /tasks/{id}/retry without each caller re-deriving them."""
    with connect() as conn:
        conn.execute(
            "UPDATE runs SET replay_params = ? WHERE id = ?", (replay_params_json, run_id)
        )


def get_run(run_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()


def get_latest_run_for_item(task_id: str, item_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM runs WHERE task_id = ? AND item_id = ? ORDER BY created_at DESC LIMIT 1",
            (task_id, item_id),
        ).fetchone()


def get_latest_run_for_task(task_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
            (task_id,),
        ).fetchone()


def list_runs_for_task(task_id: str) -> List[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM runs WHERE task_id = ? ORDER BY created_at", (task_id,)
        ).fetchall()


def _command_allowlisted(conn: sqlite3.Connection, command: str) -> bool:
    """A pattern matches: exactly, as a raw prefix if it ends in '*' (no real glob engine —
    deliberately simple), or — the common case — as a whole-word prefix otherwise. A bare
    pattern like "./mvnw" or "git status" is meant to mean "this command, with any
    arguments", not "this exact invocation with zero arguments" — found live: a user added
    "./mvnw" expecting it to cover "./mvnw test", "./mvnw clean install", etc., and it
    didn't, because the old rule only treated a pattern as a prefix when it explicitly ended
    in '*'. The word-boundary check (requires a following space, not just any next
    character) still prevents "git" as a pattern from accidentally matching "github-cli" or
    similar — but "git" itself would still match "git push --force", so this is only as
    safe as the pattern a human actually chose to allowlist, same trust model as before."""
    for row in conn.execute("SELECT pattern FROM bash_allowlist").fetchall():
        pattern = row["pattern"]
        if pattern.endswith("*"):
            if command.startswith(pattern[:-1]):
                return True
        elif command == pattern or command.startswith(pattern + " "):
            return True
    return False


def insert_bash_approval(
    approval_id: str, run_id: Optional[str], task_id: Optional[str], command: str, cwd: Optional[str]
) -> str:
    """Creates the approval row and immediately resolves it if the command is already
    allowlisted, so the caller (the PreToolUse hook) never has to wait in that case."""
    with connect() as conn:
        status = "allowlisted" if _command_allowlisted(conn, command) else "pending"
        decided_at = now() if status == "allowlisted" else None
        conn.execute(
            "INSERT INTO bash_approvals (id, run_id, task_id, command, cwd, status, created_at, decided_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (approval_id, run_id, task_id, command, cwd, status, now(), decided_at),
        )
    return status


def get_bash_approval(approval_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute("SELECT * FROM bash_approvals WHERE id = ?", (approval_id,)).fetchone()


def list_pending_bash_approvals() -> List[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM bash_approvals WHERE status = 'pending' ORDER BY created_at"
        ).fetchall()


def decide_bash_approval(approval_id: str, status: str, feedback: Optional[str] = None) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE bash_approvals SET status = ?, decided_at = ?, feedback = ? WHERE id = ?",
            (status, now(), feedback, approval_id),
        )


def list_bash_allowlist() -> List[sqlite3.Row]:
    with connect() as conn:
        return conn.execute("SELECT * FROM bash_allowlist ORDER BY created_at").fetchall()


def insert_bash_allowlist_entry(entry_id: str, pattern: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO bash_allowlist (id, pattern, created_at) VALUES (?, ?, ?)",
            (entry_id, pattern, now()),
        )


def delete_bash_allowlist_entry(entry_id: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM bash_allowlist WHERE id = ?", (entry_id,))
