from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Optional, Set

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import db, runs

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

NAME_RE = re.compile(r"^[a-z0-9_-]+$")
PPM_ROOT = db.ENIAC_HOME / "ppm"

# Keep references so fire-and-forget run tasks aren't garbage collected mid-flight.
_background_tasks: Set[asyncio.Task] = set()


def _fire_and_forget(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


class ProjectCreate(BaseModel):
    name: str
    workspace_path: Optional[str] = None


class TaskCreateBody(BaseModel):
    prompt: str


@app.on_event("startup")
def on_startup() -> None:
    db.init_db()


def create_ppm_skeleton(name: str, workspace_path: Optional[str]) -> None:
    """§4.2: POST /projects owns creating the project's PPM skeleton."""
    project_dir = PPM_ROOT / name
    (project_dir / "contracts").mkdir(parents=True, exist_ok=True)
    for domain in ("frontend", "backend", "devops", "architecture"):
        (project_dir / domain / "features").mkdir(parents=True, exist_ok=True)
        (project_dir / domain / "conventions.md").touch()
    (project_dir / "conventions.md").touch()
    (project_dir / "architecture.md").touch()
    (project_dir / "project.json").write_text(
        json.dumps(
            {"name": name, "workspace_path": workspace_path, "created_at": db.now()},
            indent=2,
        )
    )


@app.post("/projects")
def create_project(body: ProjectCreate):
    if not NAME_RE.match(body.name):
        raise HTTPException(400, "name must be lowercase letters, digits, '-', '_' only")
    if db.get_project(body.name) is not None:
        raise HTTPException(409, f"project '{body.name}' already exists")

    db.insert_project(body.name, body.workspace_path)
    create_ppm_skeleton(body.name, body.workspace_path)
    return {"id": body.name, "workspace_path": body.workspace_path}


@app.post("/projects/{project_id}/tasks")
async def create_task(project_id: str, body: TaskCreateBody):
    if db.get_project(project_id) is None:
        raise HTTPException(404, f"project '{project_id}' not found")

    task_id = uuid.uuid4().hex
    db.insert_task(task_id, project_id, body.prompt)

    run_id = runs.new_run_id("context", body.prompt)
    db.insert_run(run_id, task_id, "context")
    _fire_and_forget(runs.start_run(run_id, body.prompt))

    return {"task_id": task_id, "run_id": run_id}


@app.websocket("/runs/{run_id}/stream")
async def stream_run(websocket: WebSocket, run_id: str):
    await websocket.accept()
    try:
        async for chunk in runs.stream_run(run_id):
            await websocket.send_text(chunk)
    except WebSocketDisconnect:
        return
    await websocket.close()
