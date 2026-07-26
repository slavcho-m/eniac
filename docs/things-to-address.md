# Things to Address

Gaps found while building one part of the system that need a change somewhere
else to fully resolve — usually backend work surfaced while building the
frontend. Logged here instead of fixed on the spot so unrelated work doesn't
get scope-creeped into whatever's in progress.

## Task `created_at` isn't exposed by the API

**Found:** 2026-07-25, building the sidebar's task list.

**What's missing:** `backend/app/main.py`'s `_serialize_task` doesn't include
`created_at` in its response, even though the column exists on the `tasks`
table (`backend/app/db.py`). The frontend has no way to show relative
timestamps ("18m ago") or group tasks into Today/Yesterday buckets, both of
which the reference design calls for.

**Current workaround:** the sidebar shows each task's `status` instead of a
timestamp — real data, just not what the design shows.

**Fix, when it's time:** add `created_at` to `_serialize_task`'s return dict,
add `created_at`/`Date` fields to the frontend's `Task` type
(`frontend/src/types/api.ts`), then build the relative-time formatting and
Today/Yesterday grouping in the sidebar.

## No project `description` field

**Found:** 2026-07-25, building the New Project form.

**What's missing:** the reference design's New Project form has an optional
Description field, but there's nowhere to put it — `POST /projects` only
accepts `name` and `workspace_path`, the `projects` table has no column for
it, and `project.json` doesn't write one either.

**Current workaround:** the New Project form skips this field entirely
rather than showing something that silently does nothing.

**Fix, when it's time:** add a `description` column to the `projects` table
(`backend/app/db.py`), accept it in `ProjectCreate`/`_serialize_project`
(`backend/app/main.py`), write it into `project.json`, then add the field
back to the frontend form and `Project` type.

## No custom/importable PPM location

**Found:** 2026-07-25, building the New Project form.

**What's missing:** the reference design's "Advanced options" section
(Custom PPM Location, Import Existing PPM) doesn't correspond to any real
backend capability — the PPM directory is always hardcoded to
`~/.eniac/ppm/{project_id}` in `backend/app/db.py` (`PPM_ROOT / name`), with
no way to override it or import an existing one.

**Current workaround:** the New Project form has no Advanced Options section
at all for now.

**Fix, when it's time:** this is a bigger one than the other two — would
need a real design decision (a new column/config for a custom PPM path, a
copy/merge step for "import existing," validation that an imported PPM
directory is actually well-formed) before any frontend work makes sense.

## `workspace_path` has no concept of a multi-repo orchestrator

**Found:** 2026-07-25, diagnosing why a real execution's diff wasn't showing
up for the `vidilaptopi` project. Confirmed via the run's own transcript
(`permission_denials: []`, a specific, correct-sounding summary of a real
code edit) plus a read-only, content-free check of the actual repo
(filenames/stats only) — the Assistant genuinely made a correct edit, but
`git diff` at `workspace_path` saw nothing.

**What's missing:** Eniac's whole model — the clean-tree guard before a
task's first execution (`backend/app/main.py`'s `approve_assistant`), the
diff captured for review (`backend/app/runs.py`'s `_working_tree_diff`), and
the reject/revert logic (`review_artifact`'s `git checkout --`) — assumes
`workspace_path` *is* the git repo being edited, running every git command
with `-C <workspace_path>`. `vidilaptopi`'s real `workspace_path`
(`~/www/vidilaptopi-deploy`) is actually a deploy *orchestrator*: a wrapper
repo (compose files, `.env`, a `Makefile`) whose `repos/` subdirectory
contains several independently-versioned child repos, each its own nested
`.git` (`neptun-dps`, `anhoch-dps`, `core-service`, `audit-service`,
`setec-dps`). Git doesn't see across a nested `.git` boundary, so every one
of those git commands is blind to anything an Assistant changes inside a
child repo.

**Current workaround:** user points `workspace_path` directly at the
specific child repo being worked on (e.g.
`~/www/vidilaptopi-deploy/repos/audit-service`) instead of the orchestrator
root — works today, no code changes, but means Eniac only ever sees one
service at a time and a project has to be re-pointed (or a new project
created) to switch which child repo it's targeting.

**Fix, when it's time:** a real feature, not a quick patch. Needs a design
decision on: (1) how a project marks `workspace_path` as an orchestrator
(user's framing: a checkbox/option on the project — when set, Eniac should
know this repo contains multiple child repos rather than being the one
being edited directly); (2) how the *actual* child repo a given task should
target gets identified — the Mastermind's investigation already reads
across the whole orchestrator tree (useful context, e.g. seeing how
services call each other), so this is really about scoping the
*execution-time* git operations (clean-tree guard, diff capture,
reject/revert) to whichever child repo the Assistant actually wrote to, not
about restricting what gets read during investigation; (3) whether that
child-repo scoping is auto-detected (e.g. from which nested `.git` the
Assistant's edited files fall under) or explicitly declared somewhere in
`context.md`/`requirements.md` by the Mastermind/Supervisor.

## No Override Assistant picker

**Found:** 2026-07-25, building phase 4 (task-detail page)'s execution view.

**What's missing:** `POST /tasks/{id}/approve-assistant` has accepted an
optional `{"assistant": "..."}` override since the backend's Assistant
override work landed — validated against
`backend/app/runs.py`'s `MASTERMIND_ASSISTANTS[mastermind]`, persisted back
to `task_items.assistant` via `db.set_task_item_assistant` so the record
reflects what actually ran. The frontend has no UI for it at all —
`ExecutionView` always runs the Mastermind-recommended Assistant with no way
to pick a different one before running it.

**Current workaround:** none needed day-to-day — the recommended Assistant
is normally the right one — but there's no way to override it from the UI
when it isn't.

**Fix, when it's time:** needs a dropdown/select pattern the component
library doesn't have yet (every other choice in the app so far has been a
fixed set of buttons or a text field, not an open list to pick one of N
from). Deliberately deprioritized behind building out the frontend/devops/
architect Masterminds' Assistants — a picker for choosing between Assistants
matters a lot less while only one Mastermind (backend) has more than one
Assistant configured to actually pick between.
