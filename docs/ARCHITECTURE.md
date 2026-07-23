# Eniac — Architecture Reference (v1)

> This document is the authoritative reference for Eniac's v1 architecture. It captures the design decisions made during planning, before implementation began. When implementing, prefer this document over inferred conventions. When something here proves wrong in practice, update this document as part of the same change.

---

## 1. What Eniac Is

Eniac is a personal, local, multi-agent workplace tool. It lets a single user drive a conversation-based flow from a natural-language request through to reviewed, applied code changes, using their **Claude Pro/Max subscription** as the source of model capability — invoking the `claude` CLI as a worker agent rather than calling paid model APIs directly.

Support for other worker CLIs (e.g. `codex`) is planned but out of scope for v1 — see §9.

Eniac runs entirely on the user's machine. It is single-user, cloneable from a repo, and has no cloud component beyond the LLM calls the invoked CLIs make on the user's behalf.

### Explicit non-goals for v1
- Multi-user PPM collaboration (design allows for it later; not built)
- Fully autonomous "auto mode" runs without human gates (design allows for it later; not built)
- Cross-machine sync of PPM or state
- Cloud deployment
- API-billed model access (subscription CLIs only)

---

## 2. Agent Hierarchy

Three tiers, in order of increasing specialization:

### Supervisor
Receives the user's raw prompt. Confirms intent through clarifying questions. Produces `context.md`, which captures the goal, constraints, and an ordered list of which Masterminds will be involved. Does not itself investigate code or write requirements.

### Masterminds (categorical agents)
One per domain. Each Mastermind investigates the relevant codebase and PPM, asks its own clarifying questions during investigation, and produces `requirements.md` and `tasks.md` for user approval. It recommends which Assistant should handle each task item.

- **Frontend Mastermind**
- **Backend Mastermind**
- **DevOps Mastermind**
- **Architect Mastermind**

"Understanding the existing codebase" is not a separate specialist — it is the investigation phase every Mastermind performs before producing requirements.

### Assistants (specialized leaf agents)
Each does one focused kind of work under its parent Mastermind.

| Mastermind | Assistants |
|---|---|
| Frontend | Design, Implementation, Review, Test |
| Backend | Design, Implementation, Review, Test |
| DevOps | Analysis, CI-CD Implementer, Environment |
| Architect | Discovery, Decision, Diagram |

Fourteen total. This is v1 — additions are expected as real usage reveals gaps.

### CLI-to-Assistant mapping
v1 uses `claude` for every Assistant. Multi-CLI support (e.g. adding `codex`) is deferred to a future version — see §9.

---

## 3. Flow

Every major transition is user-gated. Nothing runs autonomously in v1.

1. **User submits prompt** via the UI.
2. **Supervisor runs.** Asks clarifying questions. Confirms intent. Writes `context.md` including the Mastermind ordering (which Mastermind goes first, and why).
3. **User reviews context.** Can edit `context.md` directly. Confirms to proceed.
4. **Chosen Mastermind runs.** Reads codebase and PPM. Asks clarifying questions. Writes `requirements.md`.
5. **User reviews requirements.** Can edit directly. Approves.
6. **Mastermind writes `tasks.md`** breaking work into ordered task items, each with a recommended Assistant.
7. **User reviews tasks.** Can edit, reorder, or change recommended Assistants. Approves.
8. **For each task item:** user confirms (or overrides) the Assistant. Assistant executes via its CLI. Output arrives as file changes / diffs.
9. **User reviews diffs.** Approves or rejects. On rejection, feedback loops back for another Assistant run.
10. **When all task items are done,** task is marked complete.

### Handoff mechanism
Agents share state **through files, not memory**. `context.md`, `requirements.md`, `tasks.md`, and artifacts are the durable, human-readable, editable handoff. Each CLI invocation is stateless — everything it needs to know is in the files it reads.

### Cross-Mastermind handoffs
When a task requires more than one Mastermind (e.g. backend API change + frontend consumer), the Supervisor's Mastermind ordering in `context.md` is authoritative. Each Mastermind operates independently within its own domain folder in PPM; the shared file `contracts/` at the project root is where cross-cutting artifacts (API contracts, schemas) live.

### Autonomy toggle (future)
The design supports adding an "auto mode" later that skips user gates — since the flow is the same, gates just become no-ops. Not implemented in v1.

---

## 4. Folder Structure

Two cleanly separated halves.

### 4.1 The cloned repo (`eniac/`)

Contains **only** tool code and agent configuration. Never contains user data. Safe to share publicly.

```
eniac/
├── backend/                         # FastAPI application
├── frontend/                        # React + TypeScript + Vite
├── agents/                          # Agent configuration (nested to mirror hierarchy)
│   ├── supervisor/
│   │   └── prompt.md
│   ├── masterminds/
│   │   ├── frontend/
│   │   ├── backend/
│   │   ├── devops/
│   │   └── architect/
│   └── assistants/
│       ├── frontend/
│       │   ├── design/
│       │   ├── implementation/
│       │   ├── review/
│       │   └── test/
│       ├── backend/
│       │   ├── design/
│       │   ├── implementation/
│       │   ├── review/
│       │   └── test/
│       ├── devops/
│       │   ├── analysis/
│       │   ├── ci-cd/
│       │   └── environment/
│       └── architect/
│           ├── discovery/
│           ├── decision/
│           └── diagram/
├── docs/
│   ├── ARCHITECTURE.md              # This file
│   └── GETTING_STARTED.md
├── scripts/
│   └── start.sh                     # Startup + preflight
├── .env.example
└── README.md
```

**Agent config edits.** Users edit files in the cloned repo directly. No separate override system in v1.

### 4.2 User data (`~/.eniac/`)

Created on first run. Never committed. Contains everything runtime-generated.

```
~/.eniac/
├── config.json                      # User settings, per-project workspace pointers
├── state.db                         # SQLite: task history, run records, transcripts
├── logs/
└── ppm/                             # Per-Project Memory
    └── {project_name}/
        ├── project.json             # Metadata, workspace_path pointer
        ├── conventions.md
        ├── architecture.md
        ├── contracts/               # Cross-domain: API contracts, schemas
        ├── frontend/
        │   ├── conventions.md
        │   └── features/
        │       └── {feature_name}/
        │           ├── context.md
        │           ├── requirements.md
        │           ├── tasks.md
        │           └── artifacts/
        ├── backend/
        │   ├── conventions.md
        │   └── features/
        │       └── {feature_name}/
        │           └── (same as frontend)
        ├── devops/
        │   └── (same shape)
        └── architecture/
            └── (same shape)
```

### 4.3 Workspace code
The actual codebases Eniac operates on **live wherever the user already has them** on disk (e.g., `~/dev/shopest/`). Eniac never moves or copies workspace code into itself. Each project's `project.json` stores `workspace_path` pointing to the user's checkout. All CLI invocations run with `cwd` set to that path.

Projects without a workspace path yet (greenfield planning tasks) are allowed. Implementation-type Assistants gracefully refuse to run until a path is set.

---

## 5. Stack

- **Backend:** Python + FastAPI. Plain endpoints — no orchestration framework in v1. `asyncio.create_subprocess_exec` to spawn `claude`.
- **Persistence:**
  - PPM as plain markdown/JSON files on disk (see §4.2)
  - Tool-wide state (task history, run records, transcripts, checkpoints) in SQLite at `~/.eniac/state.db`
- **Frontend:** React + TypeScript, built with Vite.
- **Communication:** REST for actions and confirmations. WebSockets for live CLI output streaming.
- **No LangGraph in v1.** Reconsider if/when auto mode is added — the human-gated linear flow doesn't need a graph engine, and every persistence concern is already covered by files + SQLite.

### Naming and ports
- Repo / package name: `eniac`
- User data directory: `~/.eniac/`
- Backend port: `1946` (a nod to ENIAC's unveiling year)
- Frontend port: `5173` (Vite default)

---

## 6. API Surface

Nouns: `Project`, `Task`, `Run`, `File`, `AgentConfig`.

### Projects
```
POST   /projects                                   Create project (name, workspace_path?)
GET    /projects                                   List
GET    /projects/{id}                              Get
PATCH  /projects/{id}                              Update (e.g., set workspace_path)
DELETE /projects/{id}                              Delete (with confirmation flag)
```

### Tasks
```
POST   /projects/{id}/tasks                        Create task from user prompt
GET    /projects/{id}/tasks                        List
GET    /tasks/{task_id}                            Get details + status
DELETE /tasks/{task_id}                            Delete
```

### Runs
```
POST   /tasks/{task_id}/runs                       Start a run (agent_type, agent_id, params)
GET    /tasks/{task_id}/runs                       List
GET    /runs/{run_id}                              Get status + summary
POST   /runs/{run_id}/cancel                       Cancel in-flight run
WS     /runs/{run_id}/stream                       Live stdout/stderr WebSocket
```

### User approval gates
```
POST   /tasks/{task_id}/confirm-context            User accepts Supervisor's context + Mastermind ordering
POST   /tasks/{task_id}/approve-requirements       User accepts requirements.md
POST   /tasks/{task_id}/approve-tasks              User accepts tasks.md
POST   /tasks/{task_id}/approve-assistant          User picks/confirms Assistant for next task item
POST   /tasks/{task_id}/review-artifact            User approves/rejects an Assistant's output
```

### Files (PPM contents)
```
GET    /tasks/{task_id}/files                      List files for task
GET    /files?path=...                             Read file (path scoped to ~/.eniac/ppm/)
PUT    /files?path=...                             Write (user edits between agent steps)
GET    /projects/{id}/ppm/tree                     Folder tree (for UI browsing)
```

### Agent configs (read-only)
```
GET    /agents/masterminds                         List available Masterminds
GET    /agents/masterminds/{id}/assistants         List Assistants under a Mastermind
```

### Behavior notes
- **Auto-start on confirmation.** All `POST /tasks/{task_id}/confirm-*` and `/approve-*` endpoints immediately kick off the next run and return the new `run_id` in the response, so the UI can open the stream WebSocket without a second call.
- **Deferred start escape hatch.** Confirmation endpoints accept `?defer=true` to record the confirmation but *not* start the next run — used when the user wants to edit a just-produced file before letting the next agent read it.
- **Path scoping.** All `/files` endpoints validate that the requested path resolves within `~/.eniac/ppm/`. Requests outside are rejected.

### Run identifier convention
Runs use stage-prefixed slug+UUID IDs so they're greppable in logs and URLs:

- `context-{feature-slug}-{uuid}` — Supervisor writing context
- `investigation-{feature-slug}-{uuid}` — Mastermind investigating
- `requirements-{feature-slug}-{uuid}` — Mastermind producing requirements
- `tasks-{feature-slug}-{uuid}` — Mastermind producing tasks
- `execution-{feature-slug}-{task-item-id}-{uuid}` — Assistant executing a task item

The stage prefix duplicates data available in the run record but is worth the redundancy for grep/URL scanning.

### Task item identifiers
Numeric per feature (`task1`, `task2`, ...) with slug display names. Numeric keeps IDs short in URLs and doesn't require the Mastermind to invent unique slugs.

---

## 7. Setup Flow

### 7.1 First-time and every-time startup

Runs on `./scripts/start.sh` (or `make start`):

1. **Preflight checks.** Verify:
   - Required Python version
   - Required Node/npm version
   - `claude` CLI installed and authenticated
   - Backend and frontend ports free
   Any failure is a hard stop with actionable fix instructions.
2. **Detect state of `~/.eniac/`:**
   - **Not present** → first-run path (below)
   - **Present** → returning-user path (below)
3. **Launch backend + frontend.** Print the local URL to open.

### 7.2 First-run path
- Create `~/.eniac/` skeleton: empty `config.json`, initialized `state.db`, empty `ppm/`, empty `logs/`.
- Offer to create a first project now, or skip (creation is available from the UI at any time).
- Print quick-start summary + pointer to `docs/GETTING_STARTED.md`.

### 7.3 Returning-user path
Three-way prompt (default: proceed with existing):

- **Proceed with existing PPM** (default, keyable via Enter)
- **Reset with backup** — rename existing `~/.eniac/` to `~/.eniac.backup-{timestamp}/`, then create fresh skeleton
- **Reset with wipe** — delete existing `~/.eniac/`, then create fresh skeleton

### 7.4 New-project creation (from within the running app)
Not part of the startup script. Triggered from the UI. `POST /projects` creates the PPM skeleton for the project.

Form fields:
- **Project name** (identifier, validated: no spaces, lowercase, unique)
- **Workspace path** (optional — "I'll add this later" is a valid choice)

If workspace path is deferred, the UI shows a persistent "no workspace configured" indicator until it's set. Implementation-type Assistants refuse to run until a workspace exists.

### 7.5 Versioning
Deferred. When it becomes a concern, the plan is to guarantee backwards compatibility or ship a migration script — not to build version detection in v1.

---

## 8. Suggested Build Order

Build a working vertical slice first, then widen. Do **not** build the full backend before touching the frontend.

1. **Repo skeleton.** Directory structure as in §4.1, plus placeholder files.
2. **`start.sh` script.** Preflight checks, `~/.eniac/` creation, launches backend + frontend.
3. **Minimal backend.** `POST /projects`, `POST /projects/{id}/tasks` (creates task, spawns `claude` with a hardcoded Supervisor prompt, streams stdout).
4. **Minimal frontend.** Project selector, prompt input, live output panel via WebSocket.
5. **End-to-end verification.** Type a prompt in the UI, watch `claude` respond in real time. Everything else is added *on top* of a working pipe.

Once the slice works, expand incrementally:
- Persist context.md and add the confirmation gate UI
- Add Mastermind invocation from the confirmation
- Add requirements.md flow
- Add tasks.md flow
- Add Assistant execution with diff review
- Add remaining Masterminds and Assistants
- Add project management UI (list, delete, switch)
- Add file browser for PPM

File content schemas (`context.md`, `requirements.md`, `tasks.md`) are deliberately deferred — designed once the prototype reveals what they actually need to contain.

---

## 9. Open Decisions (deferred, not forgotten)

- Adding `codex` (or other worker CLIs) alongside `claude`, and which Assistants would use it — pending empirical research; v1 ships `claude`-only
- Contents of `context.md`, `requirements.md`, `tasks.md` — pending working prototype
- Whether to bundle backend + frontend into one process or run them separately in production
- Frontend design language and UI layout — separate design phase after v1 vertical slice works

---

*Last updated: at the end of the v1 planning session, before implementation began.*
