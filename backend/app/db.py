from __future__ import annotations

import sqlite3
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
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    prompt TEXT NOT NULL,
    status TEXT NOT NULL,
    feature_slug TEXT,
    masterminds TEXT,
    context_confirmed_at TEXT,
    session_id TEXT,
    pending_questions TEXT,
    requirements_approved_at TEXT,
    tasks_approved_at TEXT,
    error TEXT,
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
    created_at TEXT NOT NULL,
    PRIMARY KEY (task_id, item_id)
);
"""


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
        for column in (
            "feature_slug TEXT",
            "masterminds TEXT",
            "context_confirmed_at TEXT",
            "session_id TEXT",
            "pending_questions TEXT",
            "requirements_approved_at TEXT",
            "tasks_approved_at TEXT",
            "error TEXT",
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
        for column in ("session_id TEXT", "baseline_commit TEXT", "blocked_reason TEXT"):
            try:
                conn.execute(f"ALTER TABLE task_items ADD COLUMN {column}")
            except sqlite3.OperationalError:
                pass


def insert_project(name: str, workspace_path: Optional[str]) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO projects (id, workspace_path, created_at) VALUES (?, ?, ?)",
            (name, workspace_path, now()),
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


def insert_task(task_id: str, project_id: str, prompt: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO tasks (id, project_id, prompt, status, created_at) "
            "VALUES (?, ?, ?, 'running', ?)",
            (task_id, project_id, prompt, now()),
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


def insert_task_items(task_id: str, items: List[Dict[str, Any]]) -> None:
    with connect() as conn:
        for i, item in enumerate(items, start=1):
            conn.execute(
                "INSERT INTO task_items (task_id, item_id, slug, description, assistant, status, created_at) "
                "VALUES (?, ?, ?, ?, ?, 'pending', ?)",
                (task_id, f"task{i}", item["slug"], item["description"], item["assistant"], now()),
            )


def get_task_items(task_id: str) -> List[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM task_items WHERE task_id = ? ORDER BY item_id", (task_id,)
        ).fetchall()


def get_task_item(task_id: str, item_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM task_items WHERE task_id = ? AND item_id = ?", (task_id, item_id)
        ).fetchone()


def get_next_pending_item(task_id: str) -> Optional[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM task_items WHERE task_id = ? AND status = 'pending' ORDER BY item_id LIMIT 1",
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


def all_task_items_done(task_id: str) -> bool:
    with connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS c FROM task_items WHERE task_id = ? AND status != 'done'", (task_id,)
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
    guarantees this), it doubles as the anchor for a whole-task combined diff."""
    with connect() as conn:
        row = conn.execute(
            "SELECT baseline_commit FROM task_items WHERE task_id = ? AND baseline_commit IS NOT NULL "
            "ORDER BY item_id LIMIT 1",
            (task_id,),
        ).fetchone()
    return row["baseline_commit"] if row else None


def mark_task_completed(task_id: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE tasks SET status = 'completed' WHERE id = ?", (task_id,))


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
