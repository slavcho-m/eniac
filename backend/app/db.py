from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

ENIAC_HOME = Path.home() / ".eniac"
DB_PATH = ENIAC_HOME / "state.db"

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
