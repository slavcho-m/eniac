from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Literal, Optional, Set

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import db, runs
from .agents import BACKENDS

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


def _schedule_background(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def _fire_and_forget(run_id: str, coro) -> None:
    # Registers the run's message queue synchronously, before the response handing
    # `run_id` to the client goes out — otherwise the client's WebSocket can connect
    # before this scheduled task has run any of its own code.
    runs.register_run(run_id)
    _schedule_background(coro)


class ProjectCreate(BaseModel):
    name: str
    workspace_path: Optional[str] = None
    description: Optional[str] = None


class TaskCreateBody(BaseModel):
    prompt: str
    repo_scope: Optional[str] = None
    image_paths: Optional[List[str]] = None
    mode: Literal["discuss", "patch", "ship"] = "ship"
    # Kept in sync by hand with backend.app.agents.BACKENDS' keys -- not worth dynamic
    # validation machinery for 2 backends, same stance `mode` already takes here.
    agent: Literal["claude", "codex"] = "claude"


class RespondBody(BaseModel):
    answer: str
    image_paths: Optional[List[str]] = None


class ReviewArtifactBody(BaseModel):
    approved: bool
    feedback: Optional[str] = None


class ProjectUpdate(BaseModel):
    workspace_path: Optional[str] = None


class ApproveAssistantBody(BaseModel):
    assistant: Optional[str] = None


class WriteFileBody(BaseModel):
    content: str


class BashApprovalCreateBody(BaseModel):
    run_id: Optional[str] = None
    task_id: Optional[str] = None
    command: str
    cwd: Optional[str] = None


class BashApprovalDecideBody(BaseModel):
    decision: str
    allowlist_pattern: Optional[str] = None
    feedback: Optional[str] = None


class BashAllowlistCreateBody(BaseModel):
    pattern: str


class RejectAmendmentBody(BaseModel):
    feedback: str


class ConsultMastermindBody(BaseModel):
    message: str


@app.on_event("startup")
def on_startup() -> None:
    db.init_db()


def _effective_workspace_path(project, task) -> Optional[str]:
    """The real filesystem path a task's Supervisor/Mastermind/Assistant pipeline and git
    plumbing should operate against. For an ordinary project this is just
    project["workspace_path"] unchanged (task["repo_scope"] is None/"." — the overwhelming
    common case). For a node-scoped task on an orchestrator project (see runs.discover_repos),
    task["repo_scope"] names which child repo under workspace_path this task is scoped to —
    everywhere downstream (investigation, execution, diff, revert) then behaves exactly like
    an ordinary single-repo project pointed at that child path, no other code changes needed."""
    base = project["workspace_path"]
    if not base:
        return base
    scope = task["repo_scope"]
    if not scope or scope == ".":
        return base
    return str(Path(base).expanduser() / scope)


def _current_mastermind(task) -> str:
    """Which mastermind is actively driving this task right now. A task can recommend
    several masterminds in sequence (task["masterminds"], ordered by the Supervisor);
    task["mastermind_index"] tracks how far through that list we've advanced (NULL/absent
    on any task predating this column, or still on its first mastermind, both meaning 0)."""
    masterminds = json.loads(task["masterminds"])
    return masterminds[task["mastermind_index"] or 0]


def _start_next_mastermind(task, task_id: str, masterminds: list, next_index: int) -> str:
    """Called instead of mark_task_completed once a mastermind's task items are all done
    and more masterminds remain — kicks off the next one's requirements stage. Mirrors
    confirm_context's fresh (non-resumed) requirements-stage start, but for masterminds[1:]:
    context.md is copied into the new mastermind's own features/<slug>/ dir (keeping the
    existing convention that each domain's PPM folder is self-contained), and the prompt
    gets a section inlining every already-completed mastermind's requirements.md/tasks.md —
    same "inline the actual file content" pattern _project_context_block already uses for
    architecture.md/conventions.md, rather than pointing at a path the mastermind's own
    tools may not have access to — so this mastermind doesn't plan in isolation and end up
    contradicting or duplicating what's already committed to."""
    previous_mastermind = masterminds[task["mastermind_index"] or 0]
    next_mastermind = masterminds[next_index]
    feature_slug = task["feature_slug"]
    project_id = task["project_id"]

    prev_dir = db.PPM_ROOT / project_id / previous_mastermind / "features" / feature_slug
    next_dir = db.PPM_ROOT / project_id / next_mastermind / "features" / feature_slug
    next_dir.mkdir(parents=True, exist_ok=True)
    context_md = (prev_dir / "context.md").read_text()
    (next_dir / "context.md").write_text(context_md)

    prior_sections = []
    for m in masterminds[:next_index]:
        m_dir = db.PPM_ROOT / project_id / m / "features" / feature_slug
        requirements_md = (m_dir / "requirements.md").read_text() if (m_dir / "requirements.md").exists() else ""
        tasks_md = (m_dir / "tasks.md").read_text() if (m_dir / "tasks.md").exists() else ""
        prior_sections.append(f"### {m} (already completed)\n\n{requirements_md}\n\n{tasks_md}")
    prior_block = (
        "\n\n---\n\n## Earlier Mastermind(s) In This Feature\n\nThis feature also involves "
        "other mastermind(s), already completed — their requirements and tasks are below. "
        "Read what they committed to before writing your own requirements, so your plan "
        "doesn't duplicate or conflict with theirs.\n\n" + "\n\n".join(prior_sections)
    )
    prompt = context_md + prior_block

    project = db.get_project(project_id)
    workspace_path = _effective_workspace_path(project, task)
    if not workspace_path or not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")

    history_entry = {
        "mastermind": previous_mastermind,
        "requirements_approved_at": task["requirements_approved_at"],
        "tasks_approved_at": task["tasks_approved_at"],
        "completed_at": db.now(),
    }
    db.advance_task_mastermind(task_id, next_index, history_entry)

    run_id = runs.new_run_id("requirements", feature_slug)
    db.insert_run(run_id, task_id, "requirements")
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id,
            task_id,
            project_id,
            prompt,
            "requirements",
            mastermind=next_mastermind,
            workspace_path=workspace_path,
            repo_scope=task["repo_scope"],
        ),
    )
    return run_id


def _git_status_porcelain(workspace_path: str) -> Optional[str]:
    """None if not a git repo; otherwise `git status --porcelain` output (empty = clean)."""
    result = subprocess.run(
        ["git", "-C", workspace_path, "status", "--porcelain"], capture_output=True, text=True
    )
    return result.stdout if result.returncode == 0 else None


def _revert_working_tree(workspace_path: str) -> None:
    """Plain revert for a rejected Patch attempt -- not a checkpoint restore (Patch never
    creates one, since it's always exactly one shot). Never runs `git clean -fd` (too
    destructive against a real workspace), so new untracked files the attempt created are
    deliberately left behind, same policy `review_artifact`'s reject path already documents."""
    subprocess.run(["git", "checkout", "--", "."], cwd=workspace_path, check=True)


def _resolve_ppm_path(relative_path: str) -> Path:
    """Resolves a path relative to PPM_ROOT, rejecting anything that escapes it (including
    via `..` traversal) — the only path shape accepted from a client is relative, so an
    absolute-path bypass isn't possible in the first place."""
    resolved = (db.PPM_ROOT / relative_path).resolve()
    if not resolved.is_relative_to(db.PPM_ROOT.resolve()):
        raise HTTPException(400, "path must resolve within the PPM directory")
    return resolved


@app.get("/files")
def read_file(path: str):
    resolved = _resolve_ppm_path(path)
    if not resolved.is_file():
        raise HTTPException(404, f"file '{path}' not found")
    return {"path": path, "content": resolved.read_text()}


@app.put("/files")
def write_file(path: str, body: WriteFileBody):
    resolved = _resolve_ppm_path(path)
    if not resolved.is_file():
        raise HTTPException(404, f"file '{path}' not found — can only edit files that already exist")
    resolved.write_text(body.content)
    return {"path": path, "written": True}


def create_ppm_skeleton(name: str, workspace_path: Optional[str], description: Optional[str] = None) -> None:
    """§4.2: POST /projects owns creating the project's PPM skeleton."""
    project_dir = db.PPM_ROOT / name
    (project_dir / "contracts").mkdir(parents=True, exist_ok=True)
    for domain in ("frontend", "backend", "devops", "architect"):
        (project_dir / domain / "features").mkdir(parents=True, exist_ok=True)
        (project_dir / domain / "conventions.md").touch()
    (project_dir / "architecture.md").touch()
    (project_dir / "project.json").write_text(
        json.dumps(
            {
                "name": name,
                "workspace_path": workspace_path,
                "description": description,
                "created_at": db.now(),
            },
            indent=2,
        )
    )


@app.post("/projects")
def create_project(body: ProjectCreate):
    if not NAME_RE.match(body.name):
        raise HTTPException(400, "name must be lowercase letters, digits, '-', '_' only")
    if db.get_project(body.name) is not None:
        raise HTTPException(409, f"project '{body.name}' already exists")

    db.insert_project(body.name, body.workspace_path, body.description)
    create_ppm_skeleton(body.name, body.workspace_path, body.description)
    return _serialize_project(db.get_project(body.name))


def _discovered_repos(workspace_path: Optional[str]) -> list:
    """Empty for a project with no workspace_path, or one whose path doesn't currently
    exist on disk (matches the same is_dir() guard used everywhere else workspace_path is
    touched) — never raises, since this is computed on every project read."""
    if not workspace_path:
        return []
    resolved = Path(workspace_path).expanduser()
    if not resolved.is_dir():
        return []
    return runs.discover_repos(resolved)


def _serialize_project(project) -> dict:
    repos = _discovered_repos(project["workspace_path"])
    return {
        "id": project["id"],
        "workspace_path": project["workspace_path"],
        "description": project["description"],
        "created_at": project["created_at"],
        "is_orchestrator": repos != ["."] and len(repos) > 0,
        "repos": repos,
        "context_refreshed_at": project["context_refreshed_at"],
        "tasks_completed_since_context_refresh": db.count_tasks_completed_since(
            project["id"], project["context_refreshed_at"]
        ),
    }


@app.get("/agents/availability")
def get_agent_availability():
    """Which agent backends are actually usable on this machine right now -- each
    `is_authenticated()` check is a real, local, synchronous subprocess call (no caching),
    since login state can change between page loads (a `claude auth login`/`codex login`
    run in another terminal) and this is cheap enough (<200ms combined) to just re-check.
    Drives AgentSelect's per-option disabled state in the composer."""
    return {name: backend.is_authenticated() for name, backend in BACKENDS.items()}


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


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
# 7MB raw, not 10MB — base64 encoding (what the Read tool ultimately sends to the
# Messages API) inflates size by ~1.33x, and the API's real per-image cap is 10MB
# base64-encoded. 7MB raw -> ~9.3MB encoded, safely under that with margin.
MAX_IMAGE_BYTES = 7 * 1024 * 1024


@app.post("/projects/{project_id}/images")
async def upload_project_image(project_id: str, file: UploadFile = File(...)):
    if db.get_project(project_id) is None:
        raise HTTPException(404, f"project '{project_id}' not found")

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in IMAGE_EXTENSIONS:
        raise HTTPException(400, f"unsupported image type '{suffix}'")

    body = await file.read()
    if len(body) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "image exceeds the 7MB size limit")

    attachments_dir = db.PPM_ROOT / project_id / "attachments"
    attachments_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}_{Path(file.filename or 'image').name}"
    (attachments_dir / stored_name).write_bytes(body)

    relative_path = str((attachments_dir / stored_name).relative_to(db.PPM_ROOT))
    return {"path": relative_path}


@app.post("/projects/{project_id}/refresh-context")
async def refresh_project_context(project_id: str):
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(404, f"project '{project_id}' not found")
    workspace_path = project["workspace_path"]
    if not workspace_path:
        raise HTTPException(409, "project has no workspace_path set")
    if not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, f"workspace_path '{workspace_path}' does not exist")

    run_id = runs.new_run_id("project-context", project_id)
    _fire_and_forget(run_id, runs.start_context_refresh(run_id, project_id, workspace_path))
    return {"run_id": run_id}


def _context_file_entry(name: str, path: Path, repo: str) -> dict:
    """Unlike CANONICAL_FEATURE_FILES' context.md/requirements.md/tasks.md (only ever
    written once actually generated), architecture.md/conventions.md are pre-touched
    empty at project-skeleton time — so `is_file()` alone can't tell "never refreshed"
    from "refreshed but genuinely empty." `populated` (non-zero size) is the real signal;
    `modified_at` stays None until then so it reads as "never refreshed," not the touch
    time of an empty placeholder."""
    exists = path.is_file()
    populated = exists and path.stat().st_size > 0
    return {
        "name": name,
        "path": str(path.relative_to(db.PPM_ROOT)),
        "status": "populated" if populated else "empty",
        "modified_at": (
            datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat() if populated else None
        ),
        "repo": repo,
    }


@app.get("/projects/{project_id}/context-files")
def get_project_context_files(project_id: str):
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(404, f"project '{project_id}' not found")

    def entries_for(base_dir: Path, repo: str) -> list:
        by_domain = {
            domain: _context_file_entry("Conventions", base_dir / domain / "conventions.md", repo)
            for domain in sorted(runs.KNOWN_MASTERMINDS)
        }
        # "Conventions" alone reads fine when only one domain has real content at this
        # location (the common case) — but two populated conventions files at the same
        # level are otherwise indistinguishable in the list, so only then does the domain
        # name earn its place back in the label.
        populated_domains = [d for d, entry in by_domain.items() if entry["status"] == "populated"]
        if len(populated_domains) > 1:
            domain_labels = {"frontend": "Frontend", "backend": "Backend", "devops": "DevOps", "architect": "Architect"}
            for domain, entry in by_domain.items():
                entry["name"] = f"{domain_labels[domain]} Conventions"
        return [_context_file_entry("Architecture", base_dir / "architecture.md", repo), *by_domain.values()]

    root_dir = db.PPM_ROOT / project_id
    files = entries_for(root_dir, ".")
    for repo in _discovered_repos(project["workspace_path"]):
        if repo == ".":
            continue
        files.extend(entries_for(root_dir / "repos" / repo, repo))
    # A domain that never got real content just isn't shown — an empty placeholder row
    # (from create_ppm_skeleton's pre-touch) is noise, not information.
    return [f for f in files if f["status"] == "populated"]


_CONTEXT_FILENAMES = {"architecture.md", "conventions.md"}


@app.delete("/projects/{project_id}/context-files")
def delete_project_context_file(project_id: str, path: str):
    """Deletes one context file so a stale/wrong entry can be cleared without waiting on
    (or fighting) the next refresh — refresh only ever overwrites a domain that's present
    in its response, it never removes one that's dropped out, so this is the only way to
    actually get rid of a conventions.md that's no longer relevant."""
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(404, f"project '{project_id}' not found")

    resolved = _resolve_ppm_path(path)
    if resolved.name not in _CONTEXT_FILENAMES:
        raise HTTPException(400, f"'{path}' is not a context file")
    if not resolved.is_relative_to((db.PPM_ROOT / project_id).resolve()):
        raise HTTPException(400, "path does not belong to this project")
    if not resolved.is_file():
        raise HTTPException(404, f"file '{path}' not found")

    resolved.unlink()
    if resolved.name == "architecture.md":
        (resolved.parent / "architecture.json").unlink(missing_ok=True)
    return {"path": path, "deleted": True}


@app.delete("/projects/{project_id}")
def delete_project(project_id: str, confirm: bool = False, delete_ppm: bool = False):
    if db.get_project(project_id) is None:
        raise HTTPException(404, f"project '{project_id}' not found")
    if not confirm:
        raise HTTPException(400, "pass ?confirm=true to delete a project")

    db.delete_project(project_id)
    if delete_ppm:
        shutil.rmtree(db.PPM_ROOT / project_id, ignore_errors=True)
    return {"id": project_id, "deleted": True}


@app.post("/projects/{project_id}/tasks")
async def create_task(project_id: str, body: TaskCreateBody):
    project = db.get_project(project_id)
    if project is None:
        raise HTTPException(404, f"project '{project_id}' not found")

    # Patch mode has no Supervisor/Mastermind stage to catch a bad workspace implicitly --
    # checked upfront here instead, same wording/status codes approve_assistant already
    # uses for the equivalent Ship-mode guards.
    if body.mode == "patch":
        patch_workspace_path = _effective_workspace_path(project, {"repo_scope": body.repo_scope})
        if not patch_workspace_path or not Path(patch_workspace_path).expanduser().is_dir():
            raise HTTPException(400, "Patch mode requires a project workspace_path pointing to an existing directory")
        patch_git_status = _git_status_porcelain(patch_workspace_path)
        if patch_git_status is None:
            raise HTTPException(400, "workspace_path is not a git repository")
        if patch_git_status.strip():
            raise HTTPException(409, "workspace_path has uncommitted changes; commit or stash before starting a Patch task")

    image_paths_json = None
    if body.image_paths:
        for p in body.image_paths:
            if not _resolve_ppm_path(p).is_file():
                raise HTTPException(404, f"image '{p}' not found")
        image_paths_json = json.dumps(body.image_paths)

    task_id = uuid.uuid4().hex
    db.insert_task(
        task_id, project_id, body.prompt,
        repo_scope=body.repo_scope, image_paths=image_paths_json, mode=body.mode, agent=body.agent,
    )

    stage = "discuss" if body.mode == "discuss" else "patch" if body.mode == "patch" else "context"
    # Only discuss/patch actually use these on this fresh-call path (context/Supervisor
    # never touches a workspace, and never reads images) -- harmless to pass through
    # unconditionally either way. Neither discuss nor patch has a separate "confirm" step
    # like ship mode does, so this first call is the only place an initial attached image
    # can reach start_run at all -- absolute-path conversion mirrors confirm_context's own
    # below.
    workspace_path = _effective_workspace_path(project, {"repo_scope": body.repo_scope})
    image_paths = [str(db.PPM_ROOT / p) for p in body.image_paths] if body.image_paths else None
    run_id = runs.new_run_id(stage, body.prompt)
    db.insert_run(run_id, task_id, stage)
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id, task_id, project_id, body.prompt, stage,
            workspace_path=workspace_path, repo_scope=body.repo_scope, image_paths=image_paths,
        ),
    )
    _schedule_background(runs.generate_title(task_id, project_id, body.prompt))

    return {"task_id": task_id, "run_id": run_id}


def _serialize_task(task) -> dict:
    return {
        "id": task["id"],
        "project_id": task["project_id"],
        "prompt": task["prompt"],
        "status": task["status"],
        "mode": task["mode"],
        "agent": task["agent"],
        "title": task["title"],
        "feature_slug": task["feature_slug"],
        "masterminds": json.loads(task["masterminds"]) if task["masterminds"] else None,
        "current_mastermind": _current_mastermind(task) if task["masterminds"] else None,
        "mastermind_history": (
            json.loads(task["mastermind_history"]) if task["mastermind_history"] else []
        ),
        "context_confirmed_at": task["context_confirmed_at"],
        "requirements_approved_at": task["requirements_approved_at"],
        "tasks_approved_at": task["tasks_approved_at"],
        "pending_questions": (
            json.loads(task["pending_questions"]) if task["pending_questions"] else None
        ),
        "error": task["error"],
        "has_pending_amendment": task["pending_amendment"] is not None,
        "repo_scope": task["repo_scope"],
        "image_count": len(json.loads(task["image_paths"])) if task["image_paths"] else 0,
        "created_at": task["created_at"],
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


CANONICAL_FEATURE_FILES = ("context.md", "requirements.md", "tasks.md")
_APPROVED_AT_FIELD_BY_FILE = {
    "context.md": "context_confirmed_at",
    "requirements.md": "requirements_approved_at",
    "tasks.md": "tasks_approved_at",
}
_READY_STATUS_BY_FILE = {
    "context.md": "context_ready",
    "requirements.md": "requirements_ready",
    "tasks.md": "tasks_ready",
}


@app.get("/tasks/{task_id}/files")
def list_task_files(task_id: str):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")

    if task["mode"] == "patch":
        # Patch produces no persistent .md files -- its only artifact is the diff, shown
        # inline in the review view, not through FilesPanel.
        return []

    if task["mode"] == "discuss":
        discussion_dir = db.PPM_ROOT / task["project_id"] / "discussions" / task_id
        if not discussion_dir.is_dir():
            return []
        return [
            {
                "name": file_path.name,
                "path": str(file_path.relative_to(db.PPM_ROOT)),
                "status": "approved",
                "modified_at": datetime.fromtimestamp(
                    file_path.stat().st_mtime, tz=timezone.utc
                ).isoformat(),
            }
            for file_path in sorted(discussion_dir.glob("*.md"))
        ]

    if task["feature_slug"] is None:
        return []

    masterminds = json.loads(task["masterminds"])
    current_index = task["mastermind_index"] or 0
    multi = len(masterminds) > 1

    files = []
    for i, mastermind in enumerate(masterminds[: current_index + 1]):
        is_current = i == current_index
        feature_dir = db.PPM_ROOT / task["project_id"] / mastermind / "features" / task["feature_slug"]
        for name in CANONICAL_FEATURE_FILES:
            file_path = feature_dir / name
            exists = file_path.is_file()
            if is_current:
                if task[_APPROVED_AT_FIELD_BY_FILE[name]]:
                    status = "approved"
                elif exists and task["status"] == _READY_STATUS_BY_FILE[name]:
                    status = "awaiting_approval"
                else:
                    status = "draft"
            else:
                # An earlier mastermind in a multi-mastermind sequence only ever advances
                # once its own requirements/tasks were both approved, so its files are
                # already settled by the time it shows up here.
                status = "approved" if exists else "draft"
            files.append(
                {
                    "name": f"{mastermind}/{name}" if multi else name,
                    "path": str(file_path.relative_to(db.PPM_ROOT)),
                    "status": status,
                    "modified_at": (
                        datetime.fromtimestamp(file_path.stat().st_mtime, tz=timezone.utc).isoformat()
                        if exists
                        else None
                    ),
                }
            )
    return files


@app.get("/tasks/{task_id}/runs")
def list_task_runs(task_id: str):
    """Discuss mode's message history — each Run row is one turn (the user's prompt, via
    replay_params, plus the agent's reply, via its transcript). The currently in-flight
    turn (status == "running") is deliberately excluded: the frontend shows that one live
    via the run's own WebSocket stream instead, so including it here would double-render it.
    """
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")

    turns = []
    for run in db.list_runs_for_task(task_id):
        if run["status"] == "running":
            continue
        # `summary` is the agent's clean reply text, persisted by runs.py's discuss-stage
        # completion (db.set_run_summary) -- NOT re-derived from `transcript` here, whose
        # raw shape is backend-specific (Claude: one JSON blob; Codex: a JSONL event
        # stream) and has no business being parsed outside `agents/`.
        reply = run["summary"] if run["status"] == "completed" else None
        turns.append(
            {
                "run_id": run["id"],
                "prompt": json.loads(run["replay_params"])["prompt"],
                "reply": reply,
                "status": run["status"],
                "created_at": run["created_at"],
            }
        )
    return turns


STAGE_BY_CLARIFICATION_STATUS = {
    "awaiting_clarification": "context",
    "awaiting_requirements_clarification": "requirements",
    "awaiting_tasks_clarification": "tasks",
    "awaiting_reply": "discuss",
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
    if stage == "discuss":
        project = db.get_project(task["project_id"])
        extra = {"workspace_path": _effective_workspace_path(project, task)}
    elif stage != "context":
        project = db.get_project(task["project_id"])
        extra = {
            "mastermind": _current_mastermind(task),
            "workspace_path": _effective_workspace_path(project, task),
        }

    if body.image_paths:
        for p in body.image_paths:
            if not _resolve_ppm_path(p).is_file():
                raise HTTPException(404, f"image '{p}' not found")
        extra["image_paths"] = [str(db.PPM_ROOT / p) for p in body.image_paths]

    run_id = runs.new_run_id(stage, body.answer)
    db.insert_run(run_id, task_id, stage)
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            body.answer,
            stage,
            resume_session_id=task["session_id"],
            **extra,
        ),
    )

    return {"task_id": task_id, "run_id": run_id}


IN_FLIGHT_STATUS_BY_STAGE = {
    "context": "running",
    "discuss": "running",
    "patch": "running",
    "requirements": "investigating",
    "tasks": "planning_tasks",
    "execution": "tasks_ready",
    "consultation": "tasks_ready",
}


@app.post("/tasks/{task_id}/retry")
async def retry_task(task_id: str):
    """Replays the run that failed, using exactly the inputs it was started with
    (`runs.replay_params`) — recovers a task/item stuck in `failed` without redoing any
    already-approved stage."""
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["status"] != "failed":
        raise HTTPException(409, f"task is not failed (status: {task['status']})")

    last_run = db.get_latest_run_for_task(task_id)
    if last_run is None or last_run["replay_params"] is None:
        raise HTTPException(409, "no retryable run found for this task")

    replay = json.loads(last_run["replay_params"])
    stage = last_run["stage"]
    item_id = last_run["item_id"]

    db.clear_task_failure(task_id, IN_FLIGHT_STATUS_BY_STAGE[stage])
    if item_id is not None:
        db.set_task_item_status(task_id, item_id, "in_progress")

    run_id = runs.new_run_id(stage, replay["prompt"])
    db.insert_run(run_id, task_id, stage, item_id=item_id)
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            replay["prompt"],
            stage,
            resume_session_id=replay["resume_session_id"],
            mastermind=replay["mastermind"],
            workspace_path=replay["workspace_path"],
            assistant=replay["assistant"],
            item_id=item_id,
        ),
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

    first_mastermind = _current_mastermind(task)
    context_path = (
        db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "context.md"
    )
    if not context_path.exists():
        raise HTTPException(409, "context.md missing on disk")

    prompt_path = runs.mastermind_prompt_path(first_mastermind)
    if not prompt_path.exists():
        raise HTTPException(409, f"Mastermind '{first_mastermind}' is not yet configured")

    project = db.get_project(task["project_id"])
    workspace_path = _effective_workspace_path(project, task)
    if not workspace_path:
        raise HTTPException(409, "project has no workspace_path set")
    if not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, f"workspace_path '{workspace_path}' does not exist")

    confirmed_at = db.confirm_task_context(task_id)

    image_paths = (
        [str(db.PPM_ROOT / p) for p in json.loads(task["image_paths"])] if task["image_paths"] else None
    )

    run_id = runs.new_run_id("requirements", task["feature_slug"])
    db.insert_run(run_id, task_id, "requirements")
    db.set_task_investigating(task_id)
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            context_path.read_text(),
            "requirements",
            mastermind=first_mastermind,
            workspace_path=workspace_path,
            repo_scope=task["repo_scope"],
            image_paths=image_paths,
        ),
    )

    return {"task_id": task_id, "context_confirmed_at": confirmed_at, "run_id": run_id}


@app.post("/tasks/{task_id}/approve-requirements")
async def approve_requirements(task_id: str):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["status"] != "requirements_ready":
        raise HTTPException(409, f"requirements not ready (status: {task['status']})")

    first_mastermind = _current_mastermind(task)
    requirements_path = (
        db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "requirements.md"
    )
    if not requirements_path.exists():
        raise HTTPException(409, "requirements.md missing on disk")

    project = db.get_project(task["project_id"])
    workspace_path = _effective_workspace_path(project, task)
    if not workspace_path or not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")

    approved_at = db.approve_task_requirements(task_id)

    run_id = runs.new_run_id("tasks", task["feature_slug"])
    db.insert_run(run_id, task_id, "tasks")
    db.set_task_planning(task_id)
    _fire_and_forget(
        run_id,
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
        ),
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

    first_mastermind = _current_mastermind(task)
    tasks_path = (
        db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "tasks.md"
    )
    if not tasks_path.exists():
        raise HTTPException(409, "tasks.md missing on disk")

    approved_at = db.approve_task_tasks(task_id)
    return {"task_id": task_id, "tasks_approved_at": approved_at}


@app.post("/tasks/{task_id}/approve-patch")
def approve_patch(task_id: str):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["status"] != "patch_ready":
        raise HTTPException(409, f"task is not ready for patch review (status: {task['status']})")

    db.mark_task_completed(task_id)
    return {"task_id": task_id, "status": "completed"}


@app.post("/tasks/{task_id}/reject-patch")
async def reject_patch(task_id: str, body: RejectAmendmentBody):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["status"] != "patch_ready":
        raise HTTPException(409, f"task is not ready for patch review (status: {task['status']})")
    if not body.feedback:
        raise HTTPException(400, "feedback is required when rejecting")

    project = db.get_project(task["project_id"])
    workspace_path = _effective_workspace_path(project, task)
    if not workspace_path or not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")
    _revert_working_tree(workspace_path)

    db.set_task_running(task_id)

    run_id = runs.new_run_id("patch", body.feedback)
    db.insert_run(run_id, task_id, "patch")
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            body.feedback,
            "patch",
            resume_session_id=task["session_id"],
            workspace_path=workspace_path,
        ),
    )
    return {"task_id": task_id, "run_id": run_id}


@app.get("/tasks/{task_id}/patch-review")
def get_patch_review(task_id: str):
    if db.get_task(task_id) is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    run = db.get_latest_run_for_task(task_id)
    return {"diff": (run["diff"] or "") if run else "", "summary": run["summary"] if run else None}


@app.post("/tasks/{task_id}/reject-context")
async def reject_context(task_id: str, body: RejectAmendmentBody):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["status"] != "context_ready":
        raise HTTPException(409, f"context not ready (status: {task['status']})")
    if not body.feedback:
        raise HTTPException(400, "feedback is required when rejecting")

    db.set_task_running(task_id)

    run_id = runs.new_run_id("context", body.feedback)
    db.insert_run(run_id, task_id, "context")
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            body.feedback,
            "context",
            resume_session_id=task["session_id"],
        ),
    )

    return {"task_id": task_id, "run_id": run_id}


@app.post("/tasks/{task_id}/reject-requirements")
async def reject_requirements(task_id: str, body: RejectAmendmentBody):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["status"] != "requirements_ready":
        raise HTTPException(409, f"requirements not ready (status: {task['status']})")
    if not body.feedback:
        raise HTTPException(400, "feedback is required when rejecting")

    first_mastermind = _current_mastermind(task)
    project = db.get_project(task["project_id"])
    workspace_path = _effective_workspace_path(project, task)
    if not workspace_path or not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")

    db.set_task_investigating(task_id)

    run_id = runs.new_run_id("requirements", task["feature_slug"])
    db.insert_run(run_id, task_id, "requirements")
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            body.feedback,
            "requirements",
            resume_session_id=task["session_id"],
            mastermind=first_mastermind,
            workspace_path=workspace_path,
        ),
    )

    return {"task_id": task_id, "run_id": run_id}


@app.post("/tasks/{task_id}/reject-tasks")
async def reject_tasks(task_id: str, body: RejectAmendmentBody):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["status"] != "tasks_ready":
        raise HTTPException(409, f"tasks not ready (status: {task['status']})")
    if not body.feedback:
        raise HTTPException(400, "feedback is required when rejecting")

    first_mastermind = _current_mastermind(task)
    project = db.get_project(task["project_id"])
    workspace_path = _effective_workspace_path(project, task)
    if not workspace_path or not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")

    # Nothing has executed yet at this gate (approve-assistant requires
    # tasks_approved_at, which is never set before this point) -- every task_items
    # row is still 'pending', so it's safe to discard the rejected batch outright
    # rather than appending the regenerated list after it.
    db.delete_task_items(task_id)
    db.set_task_planning(task_id)

    run_id = runs.new_run_id("tasks", task["feature_slug"])
    db.insert_run(run_id, task_id, "tasks")
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            body.feedback,
            "tasks",
            resume_session_id=task["session_id"],
            mastermind=first_mastermind,
            workspace_path=workspace_path,
        ),
    )

    return {"task_id": task_id, "run_id": run_id}


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

    # The item's own recorded mastermind (which mastermind's tasks.md actually produced
    # it) rather than the task's current index — normally identical, since pending items
    # only ever belong to whichever mastermind is currently active, but this stays correct
    # even for an older item predating the `mastermind` column (falls back to current).
    first_mastermind = item["mastermind"] or _current_mastermind(task)

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
    task_workspace_path = _effective_workspace_path(project, task)
    if not task_workspace_path or not Path(task_workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")

    # An item's own `repo` further narrows the task-level path — "." (the ordinary case)
    # leaves it unchanged; a real value only ever appears on an orchestrator-root task,
    # where different items can target different child repos under the same workspace.
    item_repo = item["repo"] or "."
    workspace_path = (
        task_workspace_path
        if item_repo == "."
        else str(Path(task_workspace_path).expanduser() / item_repo)
    )
    if not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, f"repo '{item_repo}' no longer exists under workspace_path")

    git_status = _git_status_porcelain(str(Path(workspace_path).expanduser()))
    if git_status is None:
        raise HTTPException(409, "workspace_path is not a git repository")
    # Approving an item deliberately leaves its change as an uncommitted working-tree
    # edit (Eniac never auto-commits) — so only this item's repo's very first execution
    # within this task needs a clean start; later items targeting the *same* repo
    # legitimately run on top of its own prior approved-but-uncommitted progress. Scoped
    # per repo, not task-wide, since a multi-repo task's first item touching repos/b isn't
    # necessarily the task's first item overall.
    if not db.any_task_item_started_for_repo(task_id, item_repo) and git_status.strip():
        raise HTTPException(409, "workspace_path has uncommitted changes; commit or stash before running an Assistant")

    requirements_path = (
        db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "requirements.md"
    )
    requirements_md = requirements_path.read_text() if requirements_path.exists() else ""
    # A Design item for this same feature may already have produced a design.md -- folded
    # in here too so every later assistant (Implementation, typically) sees it, same
    # existence-checked read as requirements.md above; absent (most tasks skip Design
    # entirely) this is a no-op and the prompt is unchanged from before design.md existed.
    design_path = (
        db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "design.md"
    )
    design_md = design_path.read_text() if design_path.exists() else ""
    design_section = f"## Design\n\n{design_md}\n\n---\n\n" if design_md else ""
    # Whatever earlier items in this task already did to this repo -- so Review/Test (no
    # Grep/Glob anymore) don't need to discover "what changed" themselves, and a later
    # Implementation item sees exactly what a prior one already built instead of re-reading
    # those files to find out. Same diff `GET /tasks/{id}/diff` already computes for the
    # frontend's "View All Changes" button, reused here; empty/no-op for the first item to
    # touch this repo, since there's no prior baseline yet.
    prior_baseline = db.get_task_baseline_commits_by_repo(task_id).get(item_repo)
    changes_so_far = (
        runs.working_tree_diff(Path(workspace_path).expanduser(), since=prior_baseline)
        if prior_baseline
        else ""
    )
    changes_section = f"## Changes So Far\n\n```diff\n{changes_so_far}\n```\n\n---\n\n" if changes_so_far else ""
    execution_prompt = (
        f"## Full Requirements\n\n{requirements_md}\n\n---\n\n"
        f"{design_section}"
        f"{changes_section}"
        f"## Your Task Item\n\n{item['description']}"
    )

    # Checkpoint the tree before this item's own changes — earlier items in this same task
    # may already be approved-but-uncommitted, and a reject on *this* item must be able to
    # restore exactly that prior state, not wipe out earlier approved work too. Also doubles
    # as the diff anchor so this item's own changes can be isolated from theirs (§ runs.py
    # create_checkpoint).
    baseline_commit = runs.create_checkpoint(Path(workspace_path).expanduser())
    db.set_task_item_baseline(task_id, item["item_id"], baseline_commit)

    # Re-validated against *this* assistant's catalog, not just carried over blindly — the
    # Mastermind picked these skills for whichever assistant it originally recommended, but
    # an override (see `assistant` above) can point this run at a different one, whose
    # catalog may not include the same names at all.
    item_skills = [
        s
        for s in (json.loads(item["skills"]) if item["skills"] else [])
        if s in runs.ASSISTANT_SKILLS.get((first_mastermind, assistant), {})
    ]

    run_id = runs.new_run_id("execution", f"{task['feature_slug']}-{item['item_id']}")
    db.insert_run(run_id, task_id, "execution", item_id=item["item_id"])
    db.set_task_item_status(task_id, item["item_id"], "in_progress")
    _fire_and_forget(
        run_id,
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
            repo_scope=item_repo,
            skills=item_skills,
        ),
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
        task_completed = False
        run_id = None
        if db.all_task_items_done(task_id):
            masterminds = json.loads(task["masterminds"])
            next_index = (task["mastermind_index"] or 0) + 1
            if next_index < len(masterminds):
                run_id = _start_next_mastermind(task, task_id, masterminds, next_index)
            else:
                db.mark_task_completed(task_id)
                task_completed = True
        return {
            "task_id": task_id,
            "item_id": item["item_id"],
            "status": "done",
            "task_completed": task_completed,
            **({"run_id": run_id} if run_id else {}),
        }

    if not body.feedback:
        raise HTTPException(400, "feedback is required when rejecting")

    project = db.get_project(task["project_id"])
    task_workspace_path = _effective_workspace_path(project, task)
    item_repo = item["repo"] or "."
    workspace_path = Path(
        task_workspace_path if item_repo == "." else str(Path(task_workspace_path).expanduser() / item_repo)
    ).expanduser()
    # Revert to exactly the state before this item's own changes, restoring any earlier
    # items in this task that are approved but still deliberately uncommitted. Without this,
    # a reject would also discard prior approved work.
    if item["baseline_commit"]:
        runs.restore_checkpoint(workspace_path, item["baseline_commit"])

    first_mastermind = item["mastermind"] or _current_mastermind(task)

    run_id = runs.new_run_id("execution", f"{task['feature_slug']}-{item['item_id']}")
    db.insert_run(run_id, task_id, "execution", item_id=item["item_id"])
    db.set_task_item_status(task_id, item["item_id"], "in_progress")
    _fire_and_forget(
        run_id,
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
        ),
    )

    return {"task_id": task_id, "item_id": item["item_id"], "status": "in_progress", "run_id": run_id}


def _tasks_md_path(task, first_mastermind: str) -> Path:
    return db.PPM_ROOT / task["project_id"] / first_mastermind / "features" / task["feature_slug"] / "tasks.md"


def _amendment_render_items(task_id: str, amendment: dict) -> list:
    """The existing task list plus the amendment's proposed new items, in the same shape
    `runs.render_tasks_md` expects — used both to preview the diff (GET .../amendment)
    and, on approval, to write the real amended tasks.md."""
    deprecate_ids = set(amendment.get("deprecate_item_ids", []))
    reasoning = amendment.get("reasoning")
    existing = db.get_task_items(task_id)
    next_n = len(existing) + 1
    new_items = [
        {**new_item, "item_id": f"task{next_n + offset}"}
        for offset, new_item in enumerate(amendment.get("new_tasks", []))
    ]
    origin_item_id = amendment.get("origin_item_id")

    items = []
    for item in existing:
        # Checks the item's actual DB status too, not just the (possibly not-yet-applied)
        # amendment's proposed ids — so this same helper renders correctly both as a
        # pre-approval preview (nothing deprecated in the DB yet) and as the final
        # post-approval write (deprecation already applied, amendment passed in empty).
        is_deprecated = item["status"] == "deprecated" or item["item_id"] in deprecate_ids
        items.append(
            {
                "item_id": item["item_id"],
                "slug": item["slug"],
                "description": item["description"],
                "assistant": item["assistant"],
                "depends_on": json.loads(item["depends_on"]) if item["depends_on"] else [],
                "skills": json.loads(item["skills"]) if item["skills"] else [],
                "deprecated": is_deprecated,
                "deprecated_reason": item["deprecated_reason"] or (reasoning if is_deprecated else None),
            }
        )
        # Mirrors db.append_task_items' positioning: new items from a Review proposal land
        # right after the item that proposed them, not at the tail, so the preview diff
        # matches what actually happens on approval.
        if item["item_id"] == origin_item_id:
            items.extend(new_items)
    if origin_item_id is None:
        items.extend(new_items)
    return items


@app.get("/tasks/{task_id}/amendment")
def get_amendment(task_id: str):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    amendment = db.get_pending_amendment(task_id)
    if amendment is None:
        raise HTTPException(404, "no pending amendment for this task")

    # A consultation can come back needing more info instead of a proposal — same storage
    # slot, no diff to compute, the frontend shows a question instead of a diff.
    if amendment.get("kind") == "clarification":
        return {"task_id": task_id, **amendment}

    tasks_path = _tasks_md_path(task, _current_mastermind(task))
    current_md = tasks_path.read_text() if tasks_path.exists() else ""
    proposed_md = runs.render_tasks_md(_amendment_render_items(task_id, amendment))
    diff = runs.text_diff(current_md, proposed_md, "tasks.md")

    return {"task_id": task_id, "diff": diff, **amendment}


@app.post("/tasks/{task_id}/approve-amendment")
def approve_amendment(task_id: str):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    amendment = db.get_pending_amendment(task_id)
    if amendment is None:
        raise HTTPException(409, "no pending amendment for this task")
    if amendment.get("kind") == "clarification":
        raise HTTPException(409, "this is a clarification question, not a proposal — answer it via reject-amendment")

    tasks_path = _tasks_md_path(task, _current_mastermind(task))

    deprecate_ids = amendment.get("deprecate_item_ids", [])
    reasoning = amendment.get("reasoning") or "Superseded by an approved amendment."
    for item_id in deprecate_ids:
        db.set_task_item_deprecated(task_id, item_id, reasoning)

    new_item_ids = db.append_task_items(
        task_id,
        amendment.get("new_tasks", []),
        after_item_id=amendment.get("origin_item_id"),
        mastermind=_current_mastermind(task),
    )
    # Re-render from the now-updated DB state (deprecation + new items already applied
    # above) — pass an empty amendment since _amendment_render_items falls back to each
    # item's actual status, not the (now-stale) proposal.
    tasks_path.write_text(runs.render_tasks_md(_amendment_render_items(task_id, {})))
    db.clear_pending_amendment(task_id)

    # A task already sitting at 'completed' can gain real new pending work here — route
    # back through ExecutionView instead of leaving it stuck on a now-stale "all done".
    if new_item_ids and task["status"] == "completed":
        db.reopen_task_for_execution(task_id)

    return {"task_id": task_id, "new_item_ids": new_item_ids, "deprecated_item_ids": deprecate_ids}


@app.post("/tasks/{task_id}/reject-amendment")
async def reject_amendment(task_id: str, body: RejectAmendmentBody):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    amendment = db.get_pending_amendment(task_id)
    if amendment is None:
        raise HTTPException(409, "no pending amendment for this task")
    if not body.feedback:
        raise HTTPException(400, "feedback is required when rejecting")

    db.clear_pending_amendment(task_id)

    first_mastermind = _current_mastermind(task)
    project = db.get_project(task["project_id"])
    workspace_path = _effective_workspace_path(project, task)

    if amendment["source"] == "review":
        item_id = amendment["origin_item_id"]
        item = db.get_task_item(task_id, item_id)
        db.set_task_item_status(task_id, item_id, "in_progress")
        run_id = runs.new_run_id("execution", f"{task['feature_slug']}-{item_id}-amendment")
        db.insert_run(run_id, task_id, "execution", item_id=item_id)
        _fire_and_forget(
            run_id,
            runs.start_run(
                run_id,
                task_id,
                task["project_id"],
                body.feedback,
                "execution",
                resume_session_id=amendment["resume_session_id"],
                mastermind=first_mastermind,
                assistant=item["assistant"],
                workspace_path=workspace_path,
                item_id=item_id,
            ),
        )
    else:
        run_id = runs.new_run_id("consultation", task["feature_slug"])
        db.insert_run(run_id, task_id, "consultation")
        _fire_and_forget(
            run_id,
            runs.start_run(
                run_id,
                task_id,
                task["project_id"],
                body.feedback,
                "consultation",
                resume_session_id=amendment["resume_session_id"],
                mastermind=first_mastermind,
                workspace_path=workspace_path,
            ),
        )

    return {"task_id": task_id, "run_id": run_id}


@app.post("/tasks/{task_id}/consult-mastermind")
async def consult_mastermind(task_id: str, body: ConsultMastermindBody):
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    if task["tasks_approved_at"] is None:
        raise HTTPException(409, "tasks not approved yet")
    if not body.message:
        raise HTTPException(400, "message is required")

    first_mastermind = _current_mastermind(task)
    project = db.get_project(task["project_id"])
    workspace_path = _effective_workspace_path(project, task)
    if not workspace_path or not Path(workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")

    run_id = runs.new_run_id("consultation", body.message)
    db.insert_run(run_id, task_id, "consultation")
    _fire_and_forget(
        run_id,
        runs.start_run(
            run_id,
            task_id,
            task["project_id"],
            body.message,
            "consultation",
            resume_session_id=task["session_id"],
            mastermind=first_mastermind,
            workspace_path=workspace_path,
        ),
    )

    return {"task_id": task_id, "run_id": run_id}


def _serialize_task_item(item, task_id: str) -> dict:
    latest_run = db.get_latest_run_for_item(task_id, item["item_id"])
    return {
        "item_id": item["item_id"],
        "slug": item["slug"],
        "description": item["description"],
        "assistant": item["assistant"],
        "status": item["status"],
        "blocked_reason": item["blocked_reason"],
        "deprecated_reason": item["deprecated_reason"],
        "depends_on": json.loads(item["depends_on"]) if item["depends_on"] else [],
        "repo": item["repo"] or ".",
        "skills": json.loads(item["skills"]) if item["skills"] else [],
        "mastermind": item["mastermind"],
        "latest_run": (
            {
                "id": latest_run["id"],
                "status": latest_run["status"],
                "diff": latest_run["diff"],
                "summary": latest_run["summary"],
            }
            if latest_run is not None
            else None
        ),
    }


@app.get("/tasks/{task_id}/items")
def list_task_items(task_id: str):
    if db.get_task(task_id) is None:
        raise HTTPException(404, f"task '{task_id}' not found")
    return [_serialize_task_item(item, task_id) for item in db.get_task_items(task_id)]


@app.get("/tasks/{task_id}/diff")
def get_task_diff(task_id: str):
    """The whole task's combined diff — every approved (and currently pending-review) item's
    changes together, as opposed to a single item's isolated diff (`items[].latest_run.diff`).
    One diff per distinct repo the task has touched, each anchored on that repo's own first
    item's checkpoint (see db.get_task_baseline_commits_by_repo) rather than plain
    `git diff`/HEAD — for the ordinary single-repo/node-scoped case this is exactly one repo,
    same as before; an orchestrator-root task spanning multiple repos gets each repo's diff
    concatenated (real `diff --git a/... b/...` headers per repo, which the frontend's
    existing multi-file diff parser already splits on — no frontend change needed)."""
    task = db.get_task(task_id)
    if task is None:
        raise HTTPException(404, f"task '{task_id}' not found")

    baselines_by_repo = db.get_task_baseline_commits_by_repo(task_id)
    if not baselines_by_repo:
        return {"diff": ""}

    project = db.get_project(task["project_id"])
    task_workspace_path = _effective_workspace_path(project, task)
    if not task_workspace_path or not Path(task_workspace_path).expanduser().is_dir():
        raise HTTPException(409, "workspace_path is missing or no longer exists")

    diffs = []
    for repo, baseline_commit in baselines_by_repo.items():
        repo_path = (
            Path(task_workspace_path).expanduser()
            if repo == "."
            else Path(task_workspace_path).expanduser() / repo
        )
        if not repo_path.is_dir():
            continue
        repo_diff = runs.working_tree_diff(repo_path, since=baseline_commit)
        if repo_diff:
            diffs.append(repo_diff)
    return {"diff": "\n".join(diffs)}


def _serialize_bash_approval(row) -> dict:
    return {
        "id": row["id"],
        "run_id": row["run_id"],
        "task_id": row["task_id"],
        "command": row["command"],
        "cwd": row["cwd"],
        "status": row["status"],
        "created_at": row["created_at"],
        "decided_at": row["decided_at"],
        "feedback": row["feedback"],
    }


@app.post("/bash-approvals")
def create_bash_approval(body: BashApprovalCreateBody):
    """Called by the `PreToolUse` hook (agents/hooks/bash_gate.py) for every Bash call an
    Assistant makes. Resolves immediately if the command is already allowlisted; otherwise
    the row stays 'pending' until a human decides via POST .../decide, and the hook polls
    GET /bash-approvals/{id} until it does."""
    approval_id = uuid.uuid4().hex
    status = db.insert_bash_approval(approval_id, body.run_id, body.task_id, body.command, body.cwd)
    return {"id": approval_id, "status": status}


@app.get("/bash-approvals/pending")
def list_pending_bash_approvals():
    return [_serialize_bash_approval(row) for row in db.list_pending_bash_approvals()]


@app.get("/bash-approvals/{approval_id}")
def get_bash_approval(approval_id: str):
    row = db.get_bash_approval(approval_id)
    if row is None:
        raise HTTPException(404, f"bash approval '{approval_id}' not found")
    return _serialize_bash_approval(row)


@app.post("/bash-approvals/{approval_id}/decide")
def decide_bash_approval(approval_id: str, body: BashApprovalDecideBody):
    row = db.get_bash_approval(approval_id)
    if row is None:
        raise HTTPException(404, f"bash approval '{approval_id}' not found")
    if row["status"] != "pending":
        raise HTTPException(409, f"bash approval already decided (status: {row['status']})")
    if body.decision not in ("approve", "deny"):
        raise HTTPException(400, "decision must be 'approve' or 'deny'")

    if body.decision == "deny":
        db.decide_bash_approval(approval_id, "denied", feedback=body.feedback)
        return _serialize_bash_approval(db.get_bash_approval(approval_id))

    if body.allowlist_pattern:
        db.insert_bash_allowlist_entry(uuid.uuid4().hex, body.allowlist_pattern)
        db.decide_bash_approval(approval_id, "allowlisted")
    else:
        db.decide_bash_approval(approval_id, "approved")
    return _serialize_bash_approval(db.get_bash_approval(approval_id))


def _serialize_bash_allowlist_entry(row) -> dict:
    return {"id": row["id"], "pattern": row["pattern"], "created_at": row["created_at"]}


@app.get("/bash-allowlist")
def list_bash_allowlist():
    return [_serialize_bash_allowlist_entry(row) for row in db.list_bash_allowlist()]


@app.post("/bash-allowlist")
def create_bash_allowlist_entry(body: BashAllowlistCreateBody):
    entry_id = uuid.uuid4().hex
    db.insert_bash_allowlist_entry(entry_id, body.pattern)
    return {"id": entry_id, "pattern": body.pattern}


@app.delete("/bash-allowlist/{entry_id}")
def delete_bash_allowlist_entry(entry_id: str):
    db.delete_bash_allowlist_entry(entry_id)
    return {"id": entry_id, "deleted": True}


@app.get("/agents/masterminds")
def list_masterminds():
    return sorted(runs.KNOWN_MASTERMINDS)


@app.get("/agents/masterminds/{mastermind}/assistants")
def list_mastermind_assistants(mastermind: str):
    if mastermind not in runs.MASTERMIND_ASSISTANTS:
        raise HTTPException(404, f"Mastermind '{mastermind}' not found")
    return [
        {"name": assistant, "configured": runs.assistant_prompt_path(mastermind, assistant).exists()}
        for assistant in sorted(runs.MASTERMIND_ASSISTANTS[mastermind])
    ]


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
        "summary": run["summary"],
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
