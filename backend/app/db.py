from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

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
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    transcript TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
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
        ):
            try:
                conn.execute(f"ALTER TABLE tasks ADD COLUMN {column}")
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
    task_id: str, session_id: str, questions_json: str
) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET status = 'awaiting_clarification', session_id = ?, "
            "pending_questions = ? WHERE id = ?",
            (session_id, questions_json, task_id),
        )


def mark_task_failed(task_id: str) -> None:
    with connect() as conn:
        conn.execute("UPDATE tasks SET status = 'failed' WHERE id = ?", (task_id,))


def confirm_task_context(task_id: str) -> str:
    confirmed_at = now()
    with connect() as conn:
        conn.execute(
            "UPDATE tasks SET context_confirmed_at = ? WHERE id = ?", (confirmed_at, task_id)
        )
    return confirmed_at


def insert_run(run_id: str, task_id: str, stage: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO runs (id, task_id, stage, status, created_at) "
            "VALUES (?, ?, ?, 'running', ?)",
            (run_id, task_id, stage, now()),
        )


def complete_run(run_id: str, status: str, transcript: str) -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE runs SET status = ?, transcript = ?, completed_at = ? WHERE id = ?",
            (status, transcript, now(), run_id),
        )
