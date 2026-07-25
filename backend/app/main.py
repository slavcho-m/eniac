from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import uuid
from pathlib import Path
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


class RespondBody(BaseModel):
    answer: str


class ReviewArtifactBody(BaseModel):
    approved: bool
    feedback: Optional[str] = None


class ProjectUpdate(BaseModel):
    workspace_path: Optional[str] = None


class ApproveAssistantBody(BaseModel):
    assistant: Optional[str] = None


@app.on_event("startup")
def on_startup() -> None:
    db.init_db()


def _git_status_porcelain(workspace_path: str) -> Optional[str]:
    """None if not a git repo; otherwise `git status --porcelain` output (empty = clean)."""
    result = subprocess.run(
        ["git", "-C", workspace_path, "status", "--porcelain"], capture_output=True, text=True
    )
    return result.stdout if result.returncode == 0 else None


def create_ppm_skeleton(name: str, workspace_path: Optional[str]) -> None:
    """§4.2: POST /projects owns creating the project's PPM skeleton."""
    project_dir = db.PPM_ROOT / name
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


def _serialize_project(project) -> dict:
    return {
        "id": project["id"],
        "workspace_path": project["workspace_path"],
        "created_at": project["created_at"],
    }


@app.get("/projects")
def list_projects():
    return [_serialize_project(p) for p in db.list_projects()]


@app.get("/projects/{project_id}")
def get_project(project_id: str):
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(404, f"project '{project_id}' not found")
    return _serialize_project(project)


@app.patch("/projects/{project_id}")
def update_project(project_id: str, body: ProjectUpdate):
    if db.get_project(project_id) is None:
        raise HTTPException(404, f"project '{project_id}' not found")
    db.update_project_workspace_path(project_id, body.workspace_path)
    return _serialize_project(db.get_project(project_id))


@app.delete("/projects/{project_id}")
def delete_project(project_id: str, confirm: bool = False):
    if db.get_project(project_id) is None:
        raise HTTPException(404, f"project '{project_id}' not found")
    if not confirm:
        raise HTTPException(400, "pass ?confirm=true to delete a project")

    db.delete_project(project_id)
    shutil.rmtree(db.PPM_ROOT / project_id, ignore_errors=True)
    return {"id": project_id, "deleted": True}


@app.post("/projects/{project_id}/tasks")
async def create_task(project_id: str, body: TaskCreateBody):
    if db.get_project(project_id) is None:
        raise HTTPException(404, f"project '{project_id}' not found")

    task_id = uuid.uuid4().hex
    db.insert_task(task_id, project_id, body.prompt)

    run_id = runs.new_run_id("context", body.prompt)
    db.insert_run(run_id, task_id, "context")
    _fire_and_forget(runs.start_run(run_id, task_id, project_id, body.prompt, "context"))

    return {"task_id": task_id, "run_id": run_id}


def _serialize_task(task) -> dict:
    return {
        "id": task["id"],
        "project_id": task["project_id"],
        "prompt": task["prompt"],
        "status": task["status"],
        "feature_slug": task["feature_slug"],
        "masterminds": json.loads(task["masterminds"]) if task["masterminds"] else None,
        "context_confirmed_at": task["context_confirmed_at"],
        "requirements_approved_at": task["requirements_approved_at"],
        "tasks_approved_at": task["tasks_approved_at"],
        "pending_questions": (
            json.loads(task["pending_questions"]) if task["pending_questions"] else None
        ),
    }


@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    return _serialize_task(task)


@app.get("/projects/{project_id}/tasks")
def list_project_tasks(project_id: str):
    if db.get_project(project_id) is None:
        raise HTTPException(404, f"project '{project_id}' not found")
    return [_serialize_task(t) for t in db.list_tasks_for_project(project_id)]


@app.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    if db.get_task(task_id) is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    db.delete_task(task_id)
    return {"id": task_id, "deleted": True}


STAGE_BY_CLARIFICATION_STATUS = {
    "awaiting_clarification": "context",
    "awaiting_requirements_clarification": "requirements",
    "awaiting_tasks_clarification": "tasks",
}


@app.post("/tasks/{task_id}/respond")
async def respond(task_id: str, body: RespondBody):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")

    stage = STAGE_BY_CLARIFICATION_STATUS.get(task["status"])
    if stage is None:
        raise HTTPException(409, f"task is not awaiting clarification (status: {task['status']})")

    extra: dict = {}
    if stage != "context":
        project = db.get_project(task["project_id"])
        masterminds = json.loads(task["masterminds"])
        extra = {"mastermind": masterminds[0], "workspace_path": project["workspace_path"]}

    run_id = runs.new_run_id(stage, body.answer)
    db.insert_run(run_id, task_id, stage)
    _fire_and_forget(
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            body.answer,
            stage,
            resume_session_id=task["session_id"],
            **extra,
        )
    )

    return {"task_id": task_id, "run_id": run_id}


@app.post("/tasks/{task_id}/confirm-context")
async def confirm_context(task_id: str):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["feature_slug"] is None:
        raise HTTPException(409, "context not ready yet")
    if task["context_confirmed_at"] is not None:
        raise HTTPException(409, "context already confirmed")

    masterminds = json.loads(task["masterminds"])
    first_mastermind = masterminds[0]
    context_path = (
        db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "context.md"
    )
    if not context_path.exists():
        raise HTTPException(409, "context.md missing on disk")

    prompt_path = runs.mastermind_prompt_path(first_mastermind)
    if not prompt_path.exists():
        raise HTTPException(409, f"Mastermind '{first_mastermind}' is not yet configured")

    project = db.get_project(task["project_id"])
    workspace_path = project["workspace_path"]
    if not workspace_path:
        raise HTTPException(409, "project has no workspace_path set")
    if not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, f"workspace_path '{workspace_path}' does not exist")

    confirmed_at = db.confirm_task_context(task_id)

    run_id = runs.new_run_id("requirements", task["feature_slug"])
    db.insert_run(run_id, task_id, "requirements")
    db.set_task_investigating(task_id)
    _fire_and_forget(
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            context_path.read_text(),
            "requirements",
            mastermind=first_mastermind,
            workspace_path=workspace_path,
        )
    )

    return {"task_id": task_id, "context_confirmed_at": confirmed_at, "run_id": run_id}


@app.post("/tasks/{task_id}/approve-requirements")
async def approve_requirements(task_id: str):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["status"] != "requirements_ready":
        raise HTTPException(409, f"requirements not ready (status: {task['status']})")

    masterminds = json.loads(task["masterminds"])
    first_mastermind = masterminds[0]
    requirements_path = (
        db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "requirements.md"
    )
    if not requirements_path.exists():
        raise HTTPException(409, "requirements.md missing on disk")

    project = db.get_project(task["project_id"])
    workspace_path = project["workspace_path"]
    if not workspace_path or not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")

    approved_at = db.approve_task_requirements(task_id)

    run_id = runs.new_run_id("tasks", task["feature_slug"])
    db.insert_run(run_id, task_id, "tasks")
    db.set_task_planning(task_id)
    _fire_and_forget(
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            "The user approved your requirements.md. Break this work into an ordered list of "
            "task items now, per the tasks.md shape described in your instructions.",
            "tasks",
            resume_session_id=task["session_id"],
            mastermind=first_mastermind,
            workspace_path=workspace_path,
        )
    )

    return {"task_id": task_id, "requirements_approved_at": approved_at, "run_id": run_id}


@app.post("/tasks/{task_id}/approve-tasks")
def approve_tasks(task_id: str):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["status"] != "tasks_ready":
        raise HTTPException(409, f"tasks not ready (status: {task['status']})")
    if task["tasks_approved_at"] is not None:
        raise HTTPException(409, "tasks already approved")

    masterminds = json.loads(task["masterminds"])
    first_mastermind = masterminds[0]
    tasks_path = (
        db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "tasks.md"
    )
    if not tasks_path.exists():
        raise HTTPException(409, "tasks.md missing on disk")

    approved_at = db.approve_task_tasks(task_id)
    return {"task_id": task_id, "tasks_approved_at": approved_at}


@app.post("/tasks/{task_id}/approve-assistant")
async def approve_assistant(task_id: str, body: Optional[ApproveAssistantBody] = None):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["tasks_approved_at"] is None:
        raise HTTPException(409, "tasks not approved yet")

    item = db.get_next_pending_item(task_id)
    if item is None:
        raise HTTPException(409, "no pending task items")

    masterminds = json.loads(task["masterminds"])
    first_mastermind = masterminds[0]

    assistant = item["assistant"]
    override = body.assistant if body else None
    if override and override != assistant:
        if override not in runs.MASTERMIND_ASSISTANTS[first_mastermind]:
            raise HTTPException(
                400, f"'{override}' is not a valid Assistant for the '{first_mastermind}' Mastermind"
            )
        assistant = override

    prompt_path = runs.assistant_prompt_path(first_mastermind, assistant)
    if not prompt_path.exists():
        raise HTTPException(409, f"Assistant '{assistant}' is not yet configured")
    if assistant != item["assistant"]:
        db.set_task_item_assistant(task_id, item["item_id"], assistant)

    project = db.get_project(task["project_id"])
    workspace_path = project["workspace_path"]
    if not workspace_path or not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")

    git_status = _git_status_porcelain(str(Path(workspace_path).expanduser()))
    if git_status is None:
        raise HTTPException(409, "workspace_path is not a git repository")
    # Approving an item deliberately leaves its change as an uncommitted working-tree
    # edit (Eniac never auto-commits) — so only the task's very first execution needs a
    # clean start; later items in the same task legitimately run on top of its own prior
    # approved-but-uncommitted progress.
    if not db.any_task_item_started(task_id) and git_status.strip():
        raise HTTPException(409, "workspace_path has uncommitted changes; commit or stash before running an Assistant")

    requirements_path = (
        db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "requirements.md"
    )
    requirements_md = requirements_path.read_text() if requirements_path.exists() else ""
    execution_prompt = (
        f"## Full Requirements\n\n{requirements_md}\n\n---\n\n## Your Task Item\n\n{item['description']}"
    )

    # Snapshot the tree's diff before this item's own changes — earlier items in this same
    # task may already be approved-but-uncommitted, and a reject on *this* item must be able
    # to restore exactly that prior state, not wipe out earlier approved work too.
    baseline_diff = subprocess.run(
        ["git", "-C", str(Path(workspace_path).expanduser()), "diff"], capture_output=True, text=True
    ).stdout
    db.set_task_item_baseline(task_id, item["item_id"], baseline_diff)

    run_id = runs.new_run_id("execution", f"{task['feature_slug']}-{item['item_id']}")
    db.insert_run(run_id, task_id, "execution", item_id=item["item_id"])
    db.set_task_item_status(task_id, item["item_id"], "in_progress")
    _fire_and_forget(
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            execution_prompt,
            "execution",
            mastermind=first_mastermind,
            assistant=assistant,
            workspace_path=workspace_path,
            item_id=item["item_id"],
        )
    )

    return {"task_id": task_id, "item_id": item["item_id"], "assistant": assistant, "run_id": run_id}


@app.post("/tasks/{task_id}/review-artifact")
async def review_artifact(task_id: str, body: ReviewArtifactBody):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")

    item = db.get_awaiting_review_item(task_id)
    if item is None:
        raise HTTPException(409, "no task item awaiting review")

    if body.approved:
        db.set_task_item_status(task_id, item["item_id"], "done")
        task_completed = db.all_task_items_done(task_id)
        if task_completed:
            db.mark_task_completed(task_id)
        return {
            "task_id": task_id,
            "item_id": item["item_id"],
            "status": "done",
            "task_completed": task_completed,
        }

    if not body.feedback:
        raise HTTPException(400, "feedback is required when rejecting")

    project = db.get_project(task["project_id"])
    workspace_path = Path(project["workspace_path"]).expanduser()
    # Revert to exactly the state before this item's own changes: wipe everything (tracked
    # changes only — see below), then reapply the baseline diff captured just before this
    # item ran, which restores any earlier items in this task that are approved but still
    # deliberately uncommitted. Without this, a reject would also discard prior approved work.
    # ponytail: `checkout -- .` only reverts tracked-file changes, not new untracked files
    # the Assistant may have created — a full pristine reset (git clean -fd) is too
    # destructive to run unconditionally against a real workspace.
    subprocess.run(["git", "-C", str(workspace_path), "checkout", "--", "."], check=False)
    if item["baseline_diff"] and item["baseline_diff"].strip():
        subprocess.run(
            ["git", "-C", str(workspace_path), "apply"],
            input=item["baseline_diff"], text=True, check=False,
        )

    masterminds = json.loads(task["masterminds"])
    first_mastermind = masterminds[0]

    run_id = runs.new_run_id("execution", f"{task['feature_slug']}-{item['item_id']}")
    db.insert_run(run_id, task_id, "execution", item_id=item["item_id"])
    db.set_task_item_status(task_id, item["item_id"], "in_progress")
    _fire_and_forget(
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            body.feedback,
            "execution",
            resume_session_id=item["session_id"],
            mastermind=first_mastermind,
            assistant=item["assistant"],
            workspace_path=str(workspace_path),
            item_id=item["item_id"],
        )
    )

    return {"task_id": task_id, "item_id": item["item_id"], "status": "in_progress", "run_id": run_id}


@app.get("/runs/{run_id}")
def get_run(run_id: str):
    run = db.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"run '{run_id}' not found")
    return {
        "id": run["id"],
        "task_id": run["task_id"],
        "stage": run["stage"],
        "item_id": run["item_id"],
        "status": run["status"],
        "diff": run["diff"],
    }


@app.websocket("/runs/{run_id}/stream")
async def stream_run(websocket: WebSocket, run_id: str):
    await websocket.accept()
    try:
        async for chunk in runs.stream_run(run_id):
            await websocket.send_text(chunk)
    except WebSocketDisconnect:
        return
    await websocket.close()
